import Database from 'better-sqlite3'
import { Kysely, SqliteDialect, Migrator, Migration } from 'kysely'
import migrations from './migrations'
import {
  DatabaseSchema,
  blueskyBridgeAccount,
  bridgeAccount,
  externalReply,
  follow,
  keyPair,
  monitoredPost,
  postMapping,
} from './schema'

export type { DatabaseSchema } from './schema'

export class APDatabase {
  db: Kysely<DatabaseSchema>
  private migrator: Migrator

  constructor(location: string) {
    const sqliteDb = new Database(location)
    sqliteDb.pragma('journal_mode = WAL')

    this.db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: sqliteDb }),
    })

    this.migrator = new Migrator({
      db: this.db,
      provider: {
        async getMigrations(): Promise<Record<string, Migration>> {
          return migrations
        },
      },
    })
  }

  async migrate(): Promise<void> {
    const { error, results } = await this.migrator.migrateToLatest()

    if (error) {
      throw error
    }

    for (const result of results ?? []) {
      if (result.status === 'Error') {
        throw new Error(`Failed to execute migration: ${result.migrationName}`)
      }
    }
  }

  async close(): Promise<void> {
    await this.db.destroy()
  }

  async createFollow(data: follow.APFollow): Promise<follow.APFollow> {
    await this.db
      .insertInto('ap_follow')
      .values(data)
      .onConflict((oc) => oc.doNothing())
      .execute()
    return data
  }

  async deleteFollow(userDid: string, actorUri: string): Promise<void> {
    await this.db
      .deleteFrom('ap_follow')
      .where('userDid', '=', userDid)
      .where('actorUri', '=', actorUri)
      .execute()
  }

  async getFollows(opts: {
    userDid: string
    cursor?: string | null
    limit: number
  }): Promise<{ follows: follow.APFollow[]; nextCursor: string | null }> {
    let query = this.db
      .selectFrom('ap_follow')
      .selectAll()
      .where('userDid', '=', opts.userDid)
      .orderBy('createdAt', 'desc')
      .limit(opts.limit + 1)

    if (opts.cursor) {
      query = query.where('createdAt', '<', opts.cursor)
    }

    const results = await query.execute()
    let nextCursor: string | null = null

    if (results.length > opts.limit) {
      results.pop()
      const lastItem = results[results.length - 1]
      nextCursor = lastItem.createdAt
    }

    return { follows: results, nextCursor }
  }

  async getFollowsCount(userDid: string): Promise<number> {
    const result = await this.db
      .selectFrom('ap_follow')
      .select((eb) => eb.fn.count('activityId').as('count'))
      .where('userDid', '=', userDid)
      .executeTakeFirst()
    return Number(result?.count ?? 0)
  }

  async getFollowers(userDid: string): Promise<follow.APFollow[]> {
    return this.db
      .selectFrom('ap_follow')
      .selectAll()
      .where('userDid', '=', userDid)
      .execute()
  }

  async createKeyPair(data: keyPair.APKeyPair): Promise<keyPair.APKeyPair> {
    await this.db.insertInto('ap_key_pair').values(data).execute()
    return data
  }

  async getKeyPair(
    userDid: string,
    type: keyPair.APKeyPair['type'],
  ): Promise<keyPair.APKeyPair | undefined> {
    return this.db
      .selectFrom('ap_key_pair')
      .selectAll()
      .where('userDid', '=', userDid)
      .where('type', '=', type)
      .executeTakeFirst()
  }

  async getKeyPairs(userDid: string): Promise<keyPair.APKeyPair[]> {
    return this.db
      .selectFrom('ap_key_pair')
      .selectAll()
      .where('userDid', '=', userDid)
      .execute()
  }

  async getMastodonBridgeAccount(): Promise<
    bridgeAccount.APBridgeAccount | undefined
  > {
    return this.db
      .selectFrom('ap_bridge_account')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst()
  }

  async saveMastodonBridgeAccount(
    data: Omit<bridgeAccount.APBridgeAccount, 'id'>,
  ): Promise<bridgeAccount.APBridgeAccount> {
    const existing = await this.getMastodonBridgeAccount()
    const now = new Date().toISOString()

    if (existing) {
      await this.db
        .updateTable('ap_bridge_account')
        .set({
          did: data.did,
          handle: data.handle,
          password: data.password,
          accessJwt: data.accessJwt,
          refreshJwt: data.refreshJwt,
          updatedAt: now,
        })
        .where('id', '=', 1)
        .execute()
    } else {
      await this.db
        .insertInto('ap_bridge_account')
        .values({
          id: 1,
          did: data.did,
          handle: data.handle,
          password: data.password,
          accessJwt: data.accessJwt,
          refreshJwt: data.refreshJwt,
          createdAt: data.createdAt || now,
          updatedAt: now,
        })
        .execute()
    }

    return { id: 1, ...data, updatedAt: now }
  }

  async updateMastodonBridgeAccountTokens(
    accessJwt: string,
    refreshJwt: string,
  ): Promise<void> {
    await this.db
      .updateTable('ap_bridge_account')
      .set({
        accessJwt,
        refreshJwt,
        updatedAt: new Date().toISOString(),
      })
      .where('id', '=', 1)
      .execute()
  }

  async deleteMastodonBridgeAccount(): Promise<void> {
    await this.db.deleteFrom('ap_bridge_account').where('id', '=', 1).execute()
  }

  async createPostMapping(
    data: postMapping.APPostMapping,
  ): Promise<postMapping.APPostMapping> {
    await this.db
      .insertInto('ap_post_mapping')
      .values(data)
      .onConflict((oc) => oc.doNothing())
      .execute()
    return data
  }

  async getPostMapping(
    atUri: string,
  ): Promise<postMapping.APPostMapping | undefined> {
    return this.db
      .selectFrom('ap_post_mapping')
      .selectAll()
      .where('atUri', '=', atUri)
      .executeTakeFirst()
  }

  async getPostMappingByApNoteId(
    apNoteId: string,
  ): Promise<postMapping.APPostMapping | undefined> {
    return this.db
      .selectFrom('ap_post_mapping')
      .selectAll()
      .where('apNoteId', '=', apNoteId)
      .executeTakeFirst()
  }

  async deletePostMapping(atUri: string): Promise<void> {
    await this.db
      .deleteFrom('ap_post_mapping')
      .where('atUri', '=', atUri)
      .execute()
  }

  async getBlueskyBridgeAccount(): Promise<
    blueskyBridgeAccount.APBlueskyBridgeAccount | undefined
  > {
    return this.db
      .selectFrom('ap_bluesky_bridge_account')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst()
  }

  async saveBlueskyBridgeAccount(
    data: Omit<blueskyBridgeAccount.APBlueskyBridgeAccount, 'id'>,
  ): Promise<blueskyBridgeAccount.APBlueskyBridgeAccount> {
    const existing = await this.getBlueskyBridgeAccount()
    const now = new Date().toISOString()

    if (existing) {
      await this.db
        .updateTable('ap_bluesky_bridge_account')
        .set({
          did: data.did,
          handle: data.handle,
          password: data.password,
          accessJwt: data.accessJwt,
          refreshJwt: data.refreshJwt,
          updatedAt: now,
        })
        .where('id', '=', 1)
        .execute()
    } else {
      await this.db
        .insertInto('ap_bluesky_bridge_account')
        .values({
          id: 1,
          did: data.did,
          handle: data.handle,
          password: data.password,
          accessJwt: data.accessJwt,
          refreshJwt: data.refreshJwt,
          createdAt: data.createdAt || now,
          updatedAt: now,
        })
        .execute()
    }

    return { id: 1, ...data, updatedAt: now }
  }

  async updateBlueskyBridgeAccountTokens(
    accessJwt: string,
    refreshJwt: string,
  ): Promise<void> {
    await this.db
      .updateTable('ap_bluesky_bridge_account')
      .set({
        accessJwt,
        refreshJwt,
        updatedAt: new Date().toISOString(),
      })
      .where('id', '=', 1)
      .execute()
  }

  async deleteBlueskyBridgeAccount(): Promise<void> {
    await this.db
      .deleteFrom('ap_bluesky_bridge_account')
      .where('id', '=', 1)
      .execute()
  }

  async createMonitoredPost(
    data: monitoredPost.APMonitoredPost,
  ): Promise<monitoredPost.APMonitoredPost> {
    await this.db
      .insertInto('ap_monitored_post')
      .values(data)
      .onConflict((oc) => oc.doNothing())
      .execute()
    return data
  }

  async getMonitoredPostsBatch(
    limit: number,
  ): Promise<monitoredPost.APMonitoredPost[]> {
    return this.db
      .selectFrom('ap_monitored_post')
      .selectAll()
      .orderBy('lastChecked', 'asc')
      .limit(limit)
      .execute()
  }

  async updateMonitoredPostLastChecked(atUri: string): Promise<void> {
    await this.db
      .updateTable('ap_monitored_post')
      .set({
        lastChecked: new Date().toISOString(),
      })
      .where('atUri', '=', atUri)
      .execute()
  }

  async deleteMonitoredPost(atUri: string): Promise<void> {
    await this.db
      .deleteFrom('ap_monitored_post')
      .where('atUri', '=', atUri)
      .execute()
  }

  async createExternalReply(
    data: externalReply.APExternalReply,
  ): Promise<externalReply.APExternalReply> {
    await this.db
      .insertInto('ap_external_reply')
      .values(data)
      .onConflict((oc) => oc.doNothing())
      .execute()
    return data
  }

  async getExternalReply(
    atUri: string,
  ): Promise<externalReply.APExternalReply | undefined> {
    return this.db
      .selectFrom('ap_external_reply')
      .selectAll()
      .where('atUri', '=', atUri)
      .executeTakeFirst()
  }

  async getExternalRepliesByParent(
    parentAtUri: string,
  ): Promise<externalReply.APExternalReply[]> {
    return this.db
      .selectFrom('ap_external_reply')
      .selectAll()
      .where('parentAtUri', '=', parentAtUri)
      .execute()
  }

  async deleteExternalReply(atUri: string): Promise<void> {
    await this.db
      .deleteFrom('ap_external_reply')
      .where('atUri', '=', atUri)
      .execute()
  }
}
