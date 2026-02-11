import * as init from './001-init'
import * as postMapping from './002-post-mapping'
import * as constellation from './003-constellation'
import * as followSharedInbox from './004-follow-shared-inbox'
import * as likesReposts from './005-ap-likes-reposts'
import * as engagementNotifications from './006-engagement-notifications'

export default {
  '001': init,
  '002': postMapping,
  '003': constellation,
  '004': followSharedInbox,
  '005': likesReposts,
  '006': engagementNotifications,
}
