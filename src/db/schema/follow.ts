export interface APFollow {
  userDid: string
  activityId: string
  actorUri: string
  actorInbox: string
  createdAt: string
}

export const tableName = 'ap_follow'

export interface PartialDB {
  [tableName]: APFollow
}
