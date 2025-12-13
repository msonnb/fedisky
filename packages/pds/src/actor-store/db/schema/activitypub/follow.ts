export interface ActivityPubFollow {
  activityId: string
  actorUri: string
  actorInbox: string
  createdAt: string
}

export const tableName = 'activitypub_follow'

export type PartialDB = { [tableName]: ActivityPubFollow }
