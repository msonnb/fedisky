import * as blueskyBridgeAccount from './bluesky-bridge-account'
import * as bridgeAccount from './bridge-account'
import * as externalReply from './external-reply'
import * as follow from './follow'
import * as keyPair from './key-pair'
import * as like from './like'
import * as monitoredPost from './monitored-post'
import * as postMapping from './post-mapping'
import * as repost from './repost'

export type DatabaseSchema = follow.PartialDB &
  keyPair.PartialDB &
  bridgeAccount.PartialDB &
  postMapping.PartialDB &
  blueskyBridgeAccount.PartialDB &
  monitoredPost.PartialDB &
  externalReply.PartialDB &
  like.PartialDB &
  repost.PartialDB

export {
  blueskyBridgeAccount,
  bridgeAccount,
  externalReply,
  follow,
  keyPair,
  like,
  monitoredPost,
  postMapping,
  repost,
}
