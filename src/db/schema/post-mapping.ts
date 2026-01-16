export interface APPostMapping {
  atUri: string
  apNoteId: string
  apActorId: string
  apActorInbox: string
  createdAt: string
}

export const tableName = 'ap_post_mapping'

export interface PartialDB {
  [tableName]: APPostMapping
}
