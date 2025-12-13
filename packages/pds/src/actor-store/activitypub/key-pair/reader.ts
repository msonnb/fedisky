import { ActivityPubKeyPair, ActorDb } from '../../db'

export class ActivityPubKeyPairReader {
  constructor(public db: ActorDb) {}

  async getKeypair(
    type: ActivityPubKeyPair['type'],
  ): Promise<ActivityPubKeyPair | undefined> {
    const keypair = await this.db.db
      .selectFrom('activitypub_key_pair')
      .where('type', '=', type)
      .selectAll()
      .executeTakeFirst()
    return keypair
  }

  async getKeypairs(): Promise<ActivityPubKeyPair[]> {
    const keypairs = await this.db.db
      .selectFrom('activitypub_key_pair')
      .selectAll()
      .execute()
    return keypairs
  }
}
