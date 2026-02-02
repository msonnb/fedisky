/**
 * In-memory state for mock Constellation server
 */

export interface SeededReply {
  parentAtUri: string // Post being replied to
  replyAtUri: string // External reply AT URI
  replyCid: string // Fake CID
  replyAuthorDid: string // External user DID
  replyAuthorHandle: string // External user handle
  replyText: string // Reply content
  replyCreatedAt: string // ISO timestamp
}

export interface State {
  replies: SeededReply[]
}

export function createState(): State {
  return { replies: [] }
}

export function seedReply(
  state: State,
  reply: Omit<SeededReply, 'replyCid' | 'replyCreatedAt'>,
): SeededReply {
  const seeded: SeededReply = {
    ...reply,
    replyCid: `bafycid${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    replyCreatedAt: new Date().toISOString(),
  }
  state.replies.push(seeded)
  return seeded
}

export function getRepliesForPost(
  state: State,
  parentAtUri: string,
): SeededReply[] {
  return state.replies.filter((r) => r.parentAtUri === parentAtUri)
}

export function getReplyByUri(
  state: State,
  replyAtUri: string,
): SeededReply | undefined {
  return state.replies.find((r) => r.replyAtUri === replyAtUri)
}

export function getReplyByAuthorDid(
  state: State,
  did: string,
): SeededReply | undefined {
  return state.replies.find((r) => r.replyAuthorDid === did)
}

export function resetState(state: State): void {
  state.replies = []
}
