import { AsyncLocalStorage } from 'node:async_hooks'
import http from 'node:http'
import { configure, getConsoleSink } from '@logtape/logtape'
import { getOpenTelemetrySink } from '@logtape/otel'
import express from 'express'
import { createHttpTerminator, HttpTerminator } from 'http-terminator'
import { APFederationConfig } from './config'
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

  constructor(opts: { ctx: AppContext; app: express.Application }) {
    this.ctx = opts.ctx
    this.app = opts.app
  }

  static async create(cfg: APFederationConfig): Promise<APFederationService> {
    await configure({
      sinks: { console: getConsoleSink(), otel: getOpenTelemetrySink() },
      loggers: [
        {
          category: 'fedify',
          sinks: ['otel', 'console'],
          lowestLevel: 'info',
        },
      ],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const ctx = AppContext.fromConfig(cfg)
    const app = express()

    app.set('trust proxy', true)
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    app.use((req, res, next) => {
      const start = Date.now()
      res.on('finish', () => {
        const duration = Date.now() - start
        logger.debug(
          {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration,
          },
          'request completed',
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
        logger.error({ err, path: req.path }, 'unhandled error')
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
      logger.info(
        {
          did: this.ctx.bridgeAccount.did,
          handle: this.ctx.bridgeAccount.handle,
        },
        'bridge account initialized',
      )
    } else {
      logger.warn(
        'bridge account not available - incoming ActivityPub replies will be disabled',
      )
    }

    const port = this.ctx.cfg.service.port
    this.server = this.app.listen(port, () => {
      logger.info({ port }, 'ActivityPub federation service started')
    })

    this.terminator = createHttpTerminator({ server: this.server })

    if (this.ctx.cfg.firehose.enabled) {
      this.firehoseProcessor = new FirehoseProcessor(this.ctx)
      await this.firehoseProcessor.start()
    }

    return this.server
  }

  async destroy(): Promise<void> {
    logger.info('shutting down ActivityPub federation service')

    if (this.firehoseProcessor) {
      await this.firehoseProcessor.stop()
      this.firehoseProcessor = undefined
    }

    if (this.terminator) {
      await this.terminator.terminate()
      this.terminator = undefined
    }

    await this.ctx.db.close()

    logger.info('ActivityPub federation service stopped')
  }
}
