import { parseSemVer } from '@fedify/fedify'
import { AppContext } from '../context'
import { apLogger } from '../logger'

export function setupNodeInfoDispatcher(ctx: AppContext) {
  ctx.federation.setNodeInfoDispatcher('/nodeinfo/2.1', async (_fedCtx) => {
    try {
      const accountCount = await ctx.pdsClient.getAccountCount()

      return {
        software: {
          name: 'atproto-activitypub',
          homepage: new URL('https://atproto.com'),
          repository: new URL('https://github.com/bluesky-social/atproto'),
          version: parseSemVer(ctx.cfg.service.version ?? '0.0.1'),
        },
        protocols: ['activitypub'],
        usage: {
          users: { total: accountCount },
          localPosts: 0,
          localComments: 0,
        },
      }
    } catch (err) {
      apLogger.warn({ err }, 'failed to dispatch nodeinfo')
      return {
        software: {
          name: 'atproto-activitypub',
          homepage: new URL('https://atproto.com'),
          repository: new URL('https://github.com/bluesky-social/atproto'),
          version: parseSemVer(ctx.cfg.service.version ?? '0.0.1'),
        },
        protocols: ['activitypub'],
        usage: {
          users: { total: 0 },
          localPosts: 0,
          localComments: 0,
        },
      }
    }
  })
}
