import {
  Create,
  Document,
  Note,
  PUBLIC_COLLECTION,
  Context,
} from '@fedify/fedify'
import { Temporal } from '@js-temporal/polyfill'

/** Represents a pre-built ActivityPub attachment */
export interface ActivityPubAttachment {
  url: URL
  mediaType: string
  name?: string // alt text
}

export interface CreateNoteActivityParams {
  /** The AT Protocol URI of the post (e.g., at://did:plc:xxx/app.bsky.feed.post/xxx) */
  atUri: string
  /** The DID of the author */
  did: string
  /** The text content of the note */
  text: string
  /** The rkey of the post */
  rkey: string
  /** Optional published timestamp (defaults to now) */
  published?: Temporal.Instant
  /** Pre-built ActivityPub attachments (images, videos) */
  attachments?: ActivityPubAttachment[]
}

/**
 * Creates a `Create` activity containing a `Note` object for ActivityPub federation.
 * This is shared between createRecord, applyWrites, and the outbox dispatcher.
 */
export function buildCreateNoteActivity(
  ctx: Context<void>,
  params: CreateNoteActivityParams,
): Create {
  const { atUri, did, published = Temporal.Now.instant() } = params

  const postUri = ctx.getObjectUri(Note, { uri: atUri })
  const to = PUBLIC_COLLECTION
  const cc = ctx.getFollowersUri(did)
  const actor = ctx.getActorUri(did)

  return new Create({
    id: new URL('#activity', postUri),
    actor,
    published,
    to,
    cc,
    object: buildNote(ctx, params),
  })
}

/**
 * Builds a Note object for ActivityPub (used in outbox).
 * Uses text/plain mediaType for fetched content.
 */
export function buildNote(
  ctx: Context<void>,
  params: CreateNoteActivityParams,
): Note {
  const {
    atUri,
    did,
    text,
    rkey,
    published = Temporal.Now.instant(),
    attachments,
  } = params

  const postUri = ctx.getObjectUri(Note, { uri: atUri })
  const to = PUBLIC_COLLECTION
  const cc = ctx.getFollowersUri(did)
  const actor = ctx.getActorUri(did)

  // Build Document objects for attachments
  const attachmentDocs = attachments?.map(
    (att) =>
      new Document({
        url: att.url,
        mediaType: att.mediaType,
        name: att.name,
      }),
  )

  return new Note({
    id: postUri,
    attribution: actor,
    to,
    cc,
    content: `<p>${text}</p>`,
    mediaType: 'text/html',
    published,
    url: new URL(`https://bsky.app/profile/${did}/post/${rkey}`),
    attachments: attachmentDocs,
  })
}
