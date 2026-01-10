import { TID, dataToCborBlock } from '@atproto/common'
import { BlobRef, lexToIpld } from '@atproto/lexicon'
import { cborToLex } from '@atproto/repo'
import { AtUri } from '@atproto/syntax'
import {
  Collection,
  Create,
  Document,
  LanguageString,
  Note,
  PUBLIC_COLLECTION,
} from '@fedify/fedify'
import { Temporal } from '@js-temporal/polyfill'

import {
  isMain as isEmbedImages,
  type Main as EmbedImages,
} from '../../lexicon/types/app/bsky/embed/images'
import {
  isMain as isEmbedVideo,
  type Main as EmbedVideo,
} from '../../lexicon/types/app/bsky/embed/video'
import type { Image as EmbedImage } from '../../lexicon/types/app/bsky/embed/images'
import type {
  Record as PostRecord,
  ReplyRef,
} from '../../lexicon/types/app/bsky/feed/post'
import type { Main as StrongRef } from '../../lexicon/types/com/atproto/repo/strongRef'
import { LocalViewer } from '../../read-after-write/viewer'
import { apLogger } from '../../logger'
import {
  downloadAttachments,
  isImageMimeType,
  isVideoMimeType,
  type AttachmentInfo,
  type DownloadedBlob,
} from './blob-downloader'
import { extractLanguage, parseHtmlContent } from './html-parser'
import { RecordConverter, type ToRecordContext } from './registry'

export const postConverter: RecordConverter<PostRecord, Note> = {
  collection: 'app.bsky.feed.post',
  objectTypes: [Note],

  async toActivityPub(ctx, identifier, record, localViewer: LocalViewer) {
    const post = record.value
    const apUri = ctx.getObjectUri(Note, { uri: record.uri })
    const to = PUBLIC_COLLECTION
    const cc = ctx.getFollowersUri(identifier)
    const actor = ctx.getActorUri(identifier)
    const replyTarget = post.reply?.parent
      ? ctx.getObjectUri(Note, { uri: post.reply.parent.uri })
      : undefined
    const content = plainTextToHtml(post.text)
    const contents: Array<string | LanguageString> = [content]
    contents.concat(
      post.langs?.map((lang) => new LanguageString(content, lang)) ?? [],
    )
    const replies = new Collection({
      id: new URL(`${apUri.href}/replies`),
      totalItems: 0,
    })
    const shares = new Collection({
      id: new URL(`${apUri.href}/shares`),
      totalItems: 0,
    })
    const likes = new Collection({
      id: new URL(`${apUri.href}/likes`),
      totalItems: 0,
    })
    const published = Temporal.Instant.from(post.createdAt)

    const note = new Note({
      id: apUri,
      attribution: actor,
      to,
      cc,
      mediaType: 'text/html',
      published,
      replyTarget,
      contents,
      replies,
      shares,
      likes,
      attachments: buildAttachmentsFromEmbed(localViewer, post.embed),
    })

    return {
      object: note,
      activity: new Create({
        id: new URL('#activity', apUri),
        url: new URL(
          `https://bsky.app/profile/${identifier}/post/${new AtUri(record.uri).rkey}`,
        ),
        actor,
        published,
        to,
        cc,
        object: note,
      }),
    }
  },

  async toRecord(ctx, identifier, object, options) {
    try {
      const content = object.content
      if (!content) {
        apLogger.debug({ noteId: object.id?.href }, 'note has no content')
        return null
      }

      const { text: htmlContent, language } = extractLanguage(content)

      const parsed = parseHtmlContent(htmlContent, language)

      // Bluesky posts have a 300 grapheme limit, but we'll use 3000 bytes as a safe limit
      const MAX_TEXT_BYTES = 3000
      let text = parsed.text
      if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
        // Truncate text to fit within limit
        const encoder = new TextEncoder()
        const decoder = new TextDecoder()
        const bytes = encoder.encode(text)
        text = decoder.decode(bytes.slice(0, MAX_TEXT_BYTES - 3)) + '...'
      }

      let embed: PostRecord['embed'] = undefined
      if (options?.blobTransactor) {
        const attachments = await extractAttachments(object)
        if (attachments.length > 0) {
          const downloadedBlobs = await downloadAttachments(
            options.blobTransactor,
            attachments,
          )
          embed = buildEmbedFromBlobs(downloadedBlobs)
        }
      }

      let reply: ReplyRef | undefined = undefined
      const replyTargetUrl = object.replyTargetId
      if (replyTargetUrl) {
        const replyRef = await parseReplyTarget(ctx, replyTargetUrl)
        if (replyRef) {
          reply = replyRef
        }
      }

      const published = object.published
      const createdAt = published
        ? published.toString()
        : new Date().toISOString()

      const record: PostRecord = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt,
      }

      if (parsed.langs.length > 0) {
        record.langs = parsed.langs
      }
      if (embed) {
        record.embed = embed
      }
      if (reply) {
        record.reply = reply
      }

      const cid = await computeRecordCid(record)

      const rkey = TID.next().toString()
      const uri = `at://${identifier}/app.bsky.feed.post/${rkey}`

      apLogger.debug(
        { uri, cid: cid.toString(), noteId: object.id?.href },
        'converted AP note to post record',
      )

      return {
        uri,
        cid: cid.toString(),
        value: record,
      }
    } catch (err) {
      apLogger.error(
        { err, noteId: object.id?.href },
        'failed to convert AP note to record',
      )
      return null
    }
  },
}

/**
 * Compute the CID for a record using the same method as the repo.
 */
async function computeRecordCid(record: PostRecord) {
  const block = await dataToCborBlock(lexToIpld(record))
  // Verify the record can be round-tripped
  cborToLex(block.bytes)
  return block.cid
}

/**
 * Extract attachment information from a Note's attachments.
 */
async function extractAttachments(note: Note): Promise<AttachmentInfo[]> {
  const attachments: AttachmentInfo[] = []

  const noteAttachments = note.getAttachments()
  for await (const attachment of noteAttachments) {
    if (attachment instanceof Document) {
      const url = attachment.url
      if (url instanceof URL) {
        attachments.push({
          url: url.href,
          mediaType: attachment.mediaType ?? undefined,
          name: attachment.name?.toString() ?? undefined,
        })
      }
    }
  }

  return attachments
}

/**
 * Build an embed object from downloaded blobs.
 */
function buildEmbedFromBlobs(
  blobs: DownloadedBlob[],
): PostRecord['embed'] | undefined {
  if (blobs.length === 0) {
    return undefined
  }

  const imageBlobs = blobs.filter((b) => isImageMimeType(b.blobRef.mimeType))
  const videoBlobs = blobs.filter((b) => isVideoMimeType(b.blobRef.mimeType))

  // Prefer images if we have them (Bluesky supports up to 4 images)
  if (imageBlobs.length > 0) {
    const images: EmbedImage[] = imageBlobs.slice(0, 4).map((blob) => ({
      image: blob.blobRef,
      alt: blob.alt,
      aspectRatio:
        blob.width && blob.height
          ? { width: blob.width, height: blob.height }
          : undefined,
    }))

    return {
      $type: 'app.bsky.embed.images',
      images,
    }
  }

  // Handle video (only one video supported)
  if (videoBlobs.length > 0) {
    const video = videoBlobs[0]
    return {
      $type: 'app.bsky.embed.video',
      video: video.blobRef,
      alt: video.alt || undefined,
      aspectRatio:
        video.width && video.height
          ? { width: video.width, height: video.height }
          : undefined,
    }
  }

  return undefined
}

/**
 * Parse an ActivityPub reply target URL to a Bluesky reply reference.
 * AP URLs are in the format: https://hostname/posts/at://did:plc:xxx/app.bsky.feed.post/rkey
 */
async function parseReplyTarget(
  ctx: unknown,
  replyTargetUrl: URL,
): Promise<ReplyRef | null> {
  try {
    const urlPath = replyTargetUrl.pathname

    // Extract AT URI from the path
    // Format: /posts/at://did:xxx/collection/rkey
    const atUriMatch = urlPath.match(/\/posts\/(at:\/\/[^/]+\/[^/]+\/[^/]+)/)
    if (!atUriMatch) {
      apLogger.debug(
        { url: replyTargetUrl.href },
        'could not parse reply target URL',
      )
      return null
    }

    const atUri = atUriMatch[1]

    // For now, we'll use the parent as both root and parent
    // In a full implementation, we would fetch the parent to find the root
    const parentRef: StrongRef = {
      uri: atUri,
      cid: '', // We would need to fetch this from the target post
    }

    // TODO: Fetch the actual root from the parent post's reply chain
    // For now, use the same reference for both
    return {
      root: parentRef,
      parent: parentRef,
    }
  } catch (err) {
    apLogger.debug(
      { err, url: replyTargetUrl.href },
      'failed to parse reply target',
    )
    return null
  }
}

function plainTextToHtml(text: string): string {
  const paragraphs = text.split('\n\n')
  return paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n')
}

function buildAttachmentsFromEmbed(
  localViewer: LocalViewer,
  embed: unknown,
): Document[] {
  const attachments: Document[] = []

  if (!embed) {
    return attachments
  }

  if (isEmbedImages(embed)) {
    const imagesEmbed = embed as EmbedImages
    for (const img of imagesEmbed.images) {
      const blobRef = BlobRef.asBlobRef(img.image.original)
      if (blobRef) {
        const url = localViewer.getImageUrl(
          'feed_fullsize',
          blobRef.ref.toString(),
        )
        attachments.push(
          new Document({
            url: new URL(url),
            mediaType: blobRef.mimeType,
            name: img.alt || '',
          }),
        )
      }
    }
  }

  if (isEmbedVideo(embed)) {
    const videoEmbed = embed as EmbedVideo
    const blobRef = BlobRef.asBlobRef(videoEmbed.video.original)
    if (blobRef) {
      const url = localViewer.getImageUrl(
        'feed_fullsize',
        blobRef.ref.toString(),
      )
      attachments.push(
        new Document({
          url: new URL(url),
          mediaType: blobRef.mimeType,
          name: videoEmbed.alt || '',
        }),
      )
    }
  }

  return attachments
}
