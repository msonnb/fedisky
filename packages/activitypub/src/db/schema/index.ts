import * as follow from './follow'
import * as keyPair from './key-pair'
import * as bridgeAccount from './bridge-account'

export type DatabaseSchema = follow.PartialDB &
  keyPair.PartialDB &
  bridgeAccount.PartialDB

export { follow, keyPair, bridgeAccount }
