import { ActivityPubKeyPairReader } from './key-pair/reader'
import { ActivityPubKeyPairTransactor } from './key-pair/transactor'
import { ActivityPubFollowReader } from './follow/reader'
import { ActivityPubFollowTransactor } from './follow/transactor'
import { ActorDb } from '../db'

export class ActivityPubReader {
  public readonly keyPair: ActivityPubKeyPairReader
  public readonly follow: ActivityPubFollowReader

  constructor(public db: ActorDb) {
    this.keyPair = new ActivityPubKeyPairReader(db)
    this.follow = new ActivityPubFollowReader(db)
  }
}

export class ActivityPubTransactor extends ActivityPubReader {
  public readonly keyPair: ActivityPubKeyPairTransactor
  public readonly follow: ActivityPubFollowTransactor

  constructor(public db: ActorDb) {
    super(db)
    this.keyPair = new ActivityPubKeyPairTransactor(db)
    this.follow = new ActivityPubFollowTransactor(db)
  }
}
