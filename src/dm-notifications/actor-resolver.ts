import type { Context } from '@fedify/fedify'
import { Person } from '@fedify/vocab'
import { logger } from '../logger'

/**
 * Resolves AP actor URLs to @username@hostname display names.
 * Uses Fedify's lookupObject for proper ActivityPub content negotiation.
 * Caches results in-memory to avoid duplicate lookups within a poll cycle.
 */
export class ActorResolver {
  private cache = new Map<string, string>()
  private fedifyCtx: Context<void>

  constructor(fedifyCtx: Context<void>) {
    this.fedifyCtx = fedifyCtx
  }

  async resolve(actorUrl: string): Promise<string> {
    const cached = this.cache.get(actorUrl)
    if (cached) return cached

    const name = await this.fetchActorName(actorUrl)
    this.cache.set(actorUrl, name)
    return name
  }

  clearCache(): void {
    this.cache.clear()
  }

  private async fetchActorName(actorUrl: string): Promise<string> {
    try {
      const actor = await this.fedifyCtx.lookupObject(actorUrl)

      if (actor instanceof Person && actor.preferredUsername) {
        const hostname = new URL(actorUrl).hostname
        return `@${actor.preferredUsername}@${hostname}`
      }
    } catch (err) {
      logger.warn('failed to resolve AP actor {actorUrl}', { actorUrl, err })
    }

    return this.fallbackFromUrl(actorUrl)
  }

  private fallbackFromUrl(actorUrl: string): string {
    try {
      const url = new URL(actorUrl)
      const pathParts = url.pathname.split('/').filter(Boolean)
      // Common patterns: /users/username, /@username, /user/username
      const username = pathParts[pathParts.length - 1]?.replace(/^@/, '')
      if (username) {
        return `@${username}@${url.hostname}`
      }
      return actorUrl
    } catch {
      return actorUrl
    }
  }
}
