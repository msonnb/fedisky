import {
  Collection,
  Create,
  Document,
  LanguageString,
  Note,
  PUBLIC_COLLECTION,
  Context,
} from '@fedify/fedify'
import { Temporal } from '@js-temporal/polyfill'

export interface ActivityPubAttachment {
  url: URL
  mediaType: string
  name?: string // alt text
}

const SENSITIVE_LABELS = ['porn', 'sexual', 'nudity', 'nsfl', 'gore']

function hasSensitiveLabels(
  labels?: { values?: { val: string }[] } | null,
): boolean {
  if (!labels?.values) return false
  return labels.values.some((label) =>
    SENSITIVE_LABELS.includes(label.val.toLowerCase()),
  )
}

export interface CreateNoteActivityParams {
  atUri: string
  did: string
  text: string
  rkey: string
  published?: Temporal.Instant
  attachments?: ActivityPubAttachment[]
  langs?: string[]
  labels?: { values?: { val: string }[] } | null
}

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
    langs,
    labels,
  } = params

  const postUri = ctx.getObjectUri(Note, { uri: atUri })
  const to = PUBLIC_COLLECTION
  const cc = ctx.getFollowersUri(did)
  const actor = ctx.getActorUri(did)

  const attachmentDocs = attachments?.map(
    (att) =>
      new Document({
        url: att.url,
        mediaType: att.mediaType,
        name: att.name,
      }),
  )

  const htmlContent = `<p>${text}</p>`

  const contents =
    langs && langs.length > 0
      ? langs.map((lang) => new LanguageString(htmlContent, lang))
      : undefined

  const sensitive = hasSensitiveLabels(labels)

  const repliesCollection = new Collection({
    id: new URL(`${postUri.href}/replies`),
    totalItems: 0,
  })

  const sharesCollection = new Collection({
    id: new URL(`${postUri.href}/shares`),
    totalItems: 0,
  })

  const likesCollection = new Collection({
    id: new URL(`${postUri.href}/likes`),
    totalItems: 0,
  })

  return new Note({
    id: postUri,
    attribution: actor,
    to,
    cc,
    content: htmlContent,
    contents,
    mediaType: 'text/html',
    published,
    url: new URL(`https://bsky.app/profile/${did}/post/${rkey}`),
    attachments: attachmentDocs,
    sensitive,
    replies: repliesCollection,
    shares: sharesCollection,
    likes: likesCollection,
  })
}
