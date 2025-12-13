import { ActivityPubKeyPair, ActorDb } from '../../db'
import { ActivityPubKeyPairReader } from './reader'

export class ActivityPubKeyPairTransactor extends ActivityPubKeyPairReader {
  constructor(public db: ActorDb) {
    super(db)
  }

  async createKeypair(
    keypair: ActivityPubKeyPair,
  ): Promise<ActivityPubKeyPair> {
    const result = await this.db.db
      .insertInto('activitypub_key_pair')
      .values(keypair)
      .returningAll()
      .executeTakeFirst()

    if (!result) {
      throw new Error('Failed to create ActivityPub key pair')
    }

    return result
  }
}
