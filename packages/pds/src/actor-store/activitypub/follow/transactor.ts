import { ActivityPubFollowReader } from './reader'
import { ActivityPubFollow, ActorDb } from '../../db'

export class ActivityPubFollowTransactor extends ActivityPubFollowReader {
  constructor(public db: ActorDb) {
    super(db)
  }

  async createFollow(follow: ActivityPubFollow): Promise<ActivityPubFollow> {
    return await this.db.db
      .insertInto('activitypub_follow')
      .values(follow)
      .onConflict((oc) => oc.column('activityId').doUpdateSet(follow))
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async deleteFollow(actorUri: string): Promise<void> {
    await this.db.db
      .deleteFrom('activitypub_follow')
      .where('actorUri', '=', actorUri)
      .execute()
  }
}
