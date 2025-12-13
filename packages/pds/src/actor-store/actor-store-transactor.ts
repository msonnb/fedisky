import { Keypair } from '@atproto/crypto'
import { ActorStoreResources } from './actor-store-resources'
import { ActorDb } from './db'
import { PreferenceTransactor } from './preference/transactor'
import { RecordTransactor } from './record/transactor'
import { RepoTransactor } from './repo/transactor'
import { ActivityPubTransactor } from './activitypub'

export class ActorStoreTransactor {
  public readonly record: RecordTransactor
  public readonly repo: RepoTransactor
  public readonly pref: PreferenceTransactor
  public readonly activityPub: ActivityPubTransactor

  constructor(
    public readonly did: string,
    protected readonly db: ActorDb,
    protected readonly keypair: Keypair,
    protected readonly resources: ActorStoreResources,
  ) {
    const blobstore = resources.blobstore(did)

    this.record = new RecordTransactor(db, blobstore)
    this.pref = new PreferenceTransactor(db)
    this.repo = new RepoTransactor(
      db,
      blobstore,
      did,
      keypair,
      resources.backgroundQueue,
    )
    this.activityPub = new ActivityPubTransactor(db)
  }
}
