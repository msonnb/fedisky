export interface APLike {
  activityId: string
  postAtUri: string
  postAuthorDid: string
  apActorId: string
  createdAt: string
  notifiedAt: string | null
}

export const tableName = 'ap_like'

export interface PartialDB {
  [tableName]: APLike
}
