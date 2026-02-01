import { AppContext } from '../context'

export function setupNodeInfoDispatcher(ctx: AppContext) {
  ctx.federation.setNodeInfoDispatcher('/nodeinfo/2.1', async (_fedCtx) => {
    const accountCount = await ctx.pdsClient.getAccountCount()

    return {
      software: {
        name: 'fedisky',
        homepage: new URL('https://github.com/msonnb/fedisky'),
        repository: new URL('https://github.com/msonnb/fedisky'),
        version: ctx.cfg.service.version ?? 'unknown',
      },
      protocols: ['activitypub'],
      usage: {
        users: { total: accountCount },
        localPosts: 0,
        localComments: 0,
      },
    }
  })
}
