import getPort from 'get-port'
import * as activitypub from '@msonnb/activitypub'
import { ActivitypubConfig } from './types'

export class TestActivitypub {
  constructor(
    public url: string,
    public port: number,
    public server: activitypub.APFederationService,
  ) {}

  static async create(config: ActivitypubConfig): Promise<TestActivitypub> {
    const port = config.port || (await getPort())
    const url = `http://localhost:${port}`
    const hostname = config.hostname || 'localhost'

    const cfg: activitypub.APFederationConfig = {
      service: {
        port,
        hostname,
        publicUrl: url,
        version: '0.0.0',
      },
      pds: {
        url: config.pdsUrl,
        adminToken: config.pdsAdminToken,
      },
      db: {
        location: ':memory:',
      },
      firehose: {
        enabled: config.firehoseEnabled ?? false,
      },
      bridge: {
        handle:
          config.bridgeHandle ??
          `mastodon.${hostname === 'localhost' ? 'test' : hostname}`,
        email: `noreply+${config.bridgeHandle ?? 'mastodon'}@${hostname}`,
        displayName: config.bridgeDisplayName ?? 'Mastodon Bridge',
        description:
          config.bridgeDescription ??
          'This account posts content from Mastodon and other Fediverse servers.',
      },
    }

    const server = await activitypub.APFederationService.create(cfg)
    await server.start()

    return new TestActivitypub(url, port, server)
  }

  async close() {
    await this.server.destroy()
  }
}
