import type { BaseAccountManager } from '../account-manager'
import { logger } from '../logger'

const CHAT_PROXY = 'did:web:api.bsky.chat#bsky_chat'

/**
 * Sends Bluesky DMs via the chat API using the bridge account's agent.
 * Proxies through the PDS to the chat service.
 */
export class ChatClient {
  private accountManager: BaseAccountManager

  constructor(accountManager: BaseAccountManager) {
    this.accountManager = accountManager
  }

  async sendDm(recipientDid: string, text: string): Promise<boolean> {
    try {
      const agent = await this.accountManager.getAgent()
      const proxyOpts = { headers: { 'atproto-proxy': CHAT_PROXY } }

      // Get or create conversation with recipient
      const convoRes = await agent.chat.bsky.convo.getConvoForMembers(
        { members: [recipientDid] },
        proxyOpts,
      )
      const convoId = convoRes.data.convo.id

      // Send the message
      await agent.chat.bsky.convo.sendMessage(
        { convoId, message: { text } },
        proxyOpts,
      )

      return true
    } catch (err) {
      logger.warn('failed to send DM to {recipientDid}', {
        recipientDid,
        err,
      })
      return false
    }
  }
}
