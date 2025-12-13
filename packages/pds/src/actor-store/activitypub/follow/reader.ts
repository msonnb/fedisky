import { ActivityPubFollow, ActorDb } from '../../db'

export class ActivityPubFollowReader {
  constructor(public db: ActorDb) {}

  async getFollows({
    cursor,
    limit,
  }: {
    cursor: string | null
    limit: number
  }): Promise<{ follows: ActivityPubFollow[]; nextCursor: string | null }> {
    let followsReq = this.db.db
      .selectFrom('activitypub_follow')
      .selectAll()
      .orderBy('createdAt', 'desc')

    if (cursor !== null) {
      followsReq = followsReq.where('createdAt', '<', cursor).limit(limit + 1)
    }

    const follows = await followsReq.execute()

    let nextCursor: string | null = null
    if (follows.length > limit) {
      follows.pop()
      nextCursor = follows.at(-1)?.createdAt ?? null
    }

    return { follows, nextCursor }
  }

  async getFollowsCount(): Promise<number> {
    const result = await this.db.db
      .selectFrom('activitypub_follow')
      .select(this.db.db.fn.count('activityId').as('count'))
      .executeTakeFirst()

    if (result === undefined) {
      return 0
    }

    return Number(result.count)
  }
}
