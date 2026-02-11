export interface APRepost {
  activityId: string
  postAtUri: string
  postAuthorDid: string
  apActorId: string
  createdAt: string
  notifiedAt: string | null
}

export const tableName = 'ap_repost'

export interface PartialDB {
  [tableName]: APRepost
}
