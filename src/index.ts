import { AsyncLocalStorage } from 'node:async_hooks'
import http from 'node:http'
import { configure, getConsoleSink } from '@logtape/logtape'
import { getOpenTelemetrySink } from '@logtape/otel'
import { trace } from '@opentelemetry/api'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { createHttpTerminator, HttpTerminator } from 'http-terminator'
import { APFederationConfig } from './config'
import { ConstellationProcessor } from './constellation'
import { AppContext } from './context'
import { createRouter } from './federation'
import { FirehoseProcessor } from './firehose'
import { logger } from './logger'

export * from './config'
export { AppContext } from './context'
export { BridgeAccountManager } from './bridge-account'
export { logger } from './logger'

export class APFederationService {
  private ctx: AppContext
  private app: express.Application
  private server?: http.Server
  private terminator?: HttpTerminator
  private firehoseProcessor?: FirehoseProcessor
  private constellationProcessor?: ConstellationProcessor

  constructor(opts: { ctx: AppContext; app: express.Application }) {
    this.ctx = opts.ctx
    this.app = opts.app
  }

  static async create(cfg: APFederationConfig): Promise<APFederationService> {
    await configure({
      sinks: {
        console: getConsoleSink(),
        otel: getOpenTelemetrySink(),
        recordException: (logRecord) => {
          if (
            logRecord.level === 'error' &&
            'err' in logRecord.properties &&
            logRecord.properties.err instanceof Error
          ) {
            trace.getActiveSpan()?.recordException(logRecord.properties.err)
          }
        },
      },
      loggers: [
        {
          category: 'fedify',
          sinks: ['otel', 'console', 'recordException'],
          lowestLevel: 'info',
        },
        {
          category: 'fedisky',
          sinks: ['otel', 'console', 'recordException'],
          lowestLevel: 'info',
        },
      ],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const ctx = AppContext.fromConfig(cfg)
    const app = express()

    app.set('trust proxy', 1)
    app.use(helmet())
    app.use(express.json({ limit: '256kb' }))
    app.use(express.urlencoded({ extended: true, limit: '256kb' }))

    const generalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      limit: 1000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })

    const inboxLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      limit: 100, // 100 requests per minute per IP
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    })

    app.use(generalLimiter)
    app.use('/inbox', inboxLimiter)
    app.use('/users/*/inbox', inboxLimiter)

    app.use((req, res, next) => {
      const start = Date.now()
      res.on('finish', () => {
        const duration = Date.now() - start
        logger.debug(
          'request completed: {method} {url} {status} {duration}ms',
          {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration,
          },
        )
      })
      next()
    })

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' })
    })

    const federationRouter = createRouter(ctx)
    app.use(federationRouter)

    app.use(
      (
        err: Error,
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        logger.error('unhandled error at {path}: {err}', {
          err,
          path: req.path,
        })
        res.status(500).json({ error: 'Internal server error' })
      },
    )

    return new APFederationService({ ctx, app })
  }

  async start(): Promise<http.Server> {
    await this.ctx.db.migrate()
    logger.info('database migrations completed')

    await this.ctx.bridgeAccount.initialize()
    if (this.ctx.bridgeAccount.isAvailable()) {
      logger.info('bridge account initialized: {did} {handle}', {
        did: this.ctx.bridgeAccount.did,
        handle: this.ctx.bridgeAccount.handle,
      })
    } else {
      logger.warn(
        'bridge account not available - incoming ActivityPub replies will be disabled',
      )
    }

    await this.ctx.blueskyBridgeAccount.initialize()
    if (this.ctx.blueskyBridgeAccount.isAvailable()) {
      logger.info('bluesky bridge account initialized: {did} {handle}', {
        did: this.ctx.blueskyBridgeAccount.did,
        handle: this.ctx.blueskyBridgeAccount.handle,
      })
    } else {
      logger.warn(
        'bluesky bridge account not available - external reply federation will be disabled',
      )
    }

    const port = this.ctx.cfg.service.port
    this.server = this.app.listen(port, () => {
      logger.info('ActivityPub federation service started on port {port}', {
        port,
      })
    })

    this.terminator = createHttpTerminator({ server: this.server })

    if (this.ctx.cfg.firehose.enabled) {
      this.firehoseProcessor = new FirehoseProcessor(this.ctx)
      await this.firehoseProcessor.start()
    }

    if (
      this.ctx.cfg.constellation.url &&
      this.ctx.blueskyBridgeAccount.isAvailable()
    ) {
      this.constellationProcessor = new ConstellationProcessor(this.ctx)
      await this.constellationProcessor.start()
    }

    return this.server
  }

  async destroy(): Promise<void> {
    logger.info('shutting down ActivityPub federation service')

    if (this.firehoseProcessor) {
      await this.firehoseProcessor.stop()
      this.firehoseProcessor = undefined
    }

    if (this.constellationProcessor) {
      await this.constellationProcessor.stop()
      this.constellationProcessor = undefined
    }

    if (this.terminator) {
      await this.terminator.terminate()
      this.terminator = undefined
    }

    await this.ctx.db.close()

    logger.info('ActivityPub federation service stopped')
  }
}
