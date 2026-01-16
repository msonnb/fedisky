import * as bridgeAccount from './bridge-account'
import * as follow from './follow'
import * as keyPair from './key-pair'
import * as postMapping from './post-mapping'

export type DatabaseSchema = follow.PartialDB &
  keyPair.PartialDB &
  bridgeAccount.PartialDB &
  postMapping.PartialDB

export { follow, keyPair, bridgeAccount, postMapping }
