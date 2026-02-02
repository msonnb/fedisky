export interface APExternalReply {
  atUri: string
  parentAtUri: string
  authorDid: string
  apNoteId: string
  createdAt: string
}

export const tableName = 'ap_external_reply'

export interface PartialDB {
  [tableName]: APExternalReply
}
