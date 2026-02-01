import { RichText, type Facet } from '@atproto/api'
import {
  isMain as isEmbedImagesOriginal,
  type Main as EmbedImages,
} from '@atproto/api/dist/client/types/app/bsky/embed/images'
import {
  isMain as isEmbedVideoOriginal,
  type Main as EmbedVideo,
} from '@atproto/api/dist/client/types/app/bsky/embed/video'
import type {
  Main as Post,
  ReplyRef,
} from '@atproto/api/dist/client/types/app/bsky/feed/post'
import {
  isMention as isMentionFacet,
  type Mention as MentionFacet,
} from '@atproto/api/dist/client/types/app/bsky/richtext/facet'
import { isSelfLabels } from '@atproto/api/dist/client/types/com/atproto/label/defs'
import { TID } from '@atproto/common'
import { cidForLex, type LexValue } from '@atproto/lex-cbor'
import { BlobRef } from '@atproto/lexicon'
import { AtUri } from '@atproto/syntax'
import {
  Collection,
  Create,
  Document,
  LanguageString,
  Mention,
  Note,
  PUBLIC_COLLECTION,
} from '@fedify/fedify'
import { Temporal } from '@js-temporal/polyfill'
import { apLogger } from '../logger'
import { PDSClient } from '../pds-client'
import { RecordConverter } from './registry'
import {
  downloadAttachments,
  isImageMimeType,
  isVideoMimeType,
  type AttachmentInfo,
  type DownloadedBlob,
} from './util/blob-handler'
import {
  type CollectedLink,
  extractLanguage,
  parseHtmlContent,
} from './util/html-parser'
import { isLocalUser } from './util/is-local-user'
import {
  contentWarningToLabels,
  labelsToContentWarning,
} from './util/label-mapping'

function isEmbedImages(embed: unknown): embed is EmbedImages {
  return isEmbedImagesOriginal(embed)
}

function isEmbedVideo(embed: unknown): embed is EmbedVideo {
  return isEmbedVideoOriginal(embed)
}

/**
 * Extract text from a string using byte indices.
 * ATProto facets use UTF-8 byte indices, so we need to convert.
 */
function extractTextByByteRange(
  text: string,
  byteStart: number,
  byteEnd: number,
): string {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const bytes = encoder.encode(text)
  return decoder.decode(bytes.slice(byteStart, byteEnd))
}

export const postConverter: RecordConverter<Post, Note> = {
  collection: 'app.bsky.feed.post',
  objectTypes: [Note],

  async toActivityPub(ctx, identifier, record, pdsClient, options) {
    const post = record.value
    const apUri = ctx.getObjectUri(Note, { uri: record.uri })
    const to = PUBLIC_COLLECTION
    const ccUris: URL[] = [ctx.getFollowersUri(identifier)]
    const actor = ctx.getActorUri(identifier)

    let replyTarget: URL | undefined
    if (post.reply?.parent) {
      const mapping = await options?.db?.getPostMapping(post.reply.parent.uri)
      if (mapping) {
        // Use the original AP note ID instead of our local object URI
        replyTarget = new URL(mapping.apNoteId)
      } else {
        replyTarget = ctx.getObjectUri(Note, { uri: post.reply.parent.uri })
      }
    }

    // Extract mentions from ATProto facets and build ActivityPub Mention tags
    const mentionTags: Mention[] = []
    if (post.facets) {
      for (const facet of post.facets) {
        for (const feature of facet.features) {
          if (isMentionFacet(feature)) {
            const mentionFeature = feature as MentionFacet
            const mentionedDid = mentionFeature.did

            // Only include mentions of local PDS users
            if (await isLocalUser(pdsClient, mentionedDid)) {
              const mentionedActorUri = ctx.getActorUri(mentionedDid)

              const mentionText = extractTextByByteRange(
                post.text,
                facet.index.byteStart,
                facet.index.byteEnd,
              )

              mentionTags.push(
                new Mention({
                  href: mentionedActorUri,
                  name: mentionText,
                }),
              )

              ccUris.push(mentionedActorUri)
            }
          }
        }
      }
    }

    const content = plainTextToHtml(post.text)
    const contents: Array<string | LanguageString> = [content]
    contents.push(
      ...(post.langs?.map((lang) => new LanguageString(content, lang)) ?? []),
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

    let sensitive: boolean | undefined
    let summary: string | undefined
    if (post.labels && isSelfLabels(post.labels)) {
      const cw = labelsToContentWarning(post.labels)
      if (cw) {
        sensitive = cw.sensitive
        summary = cw.summary
      }
    }

    const note = new Note({
      id: apUri,
      attribution: actor,
      to,
      ccs: ccUris,
      mediaType: 'text/html',
      published,
      replyTarget,
      contents,
      replies,
      shares,
      likes,
      attachments: buildAttachmentsFromEmbed(pdsClient, identifier, post.embed),
      tags: mentionTags.length > 0 ? mentionTags : undefined,
      sensitive,
      summary,
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
        ccs: ccUris,
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

      let embed: Post['embed'] = undefined
      if (options?.uploadBlob) {
        const attachments = await extractAttachments(object)
        if (attachments.length > 0) {
          const downloadedBlobs = await downloadAttachments(
            options.uploadBlob,
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

      const linkFacets = buildLinkFacets(text, parsed.links)

      const mentionFacets = await buildMentionFacetsFromLinks(
        text,
        parsed.links,
        options?.pdsClient,
      )

      const published = object.published
      const createdAt = published
        ? published.toString()
        : new Date().toISOString()

      const record: Post = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt,
      }

      if (parsed.langs.length > 0) {
        record.langs = parsed.langs
      }

      const allFacets = [...linkFacets, ...mentionFacets]
      if (allFacets.length > 0) {
        record.facets = allFacets
      }

      if (embed) {
        record.embed = embed
      }
      if (reply) {
        record.reply = reply
      }

      const summary = object.summary?.toString()
      const sensitive = object.sensitive ?? false
      if (summary || sensitive) {
        const labels = contentWarningToLabels(summary, sensitive)
        if (labels) {
          record.labels = labels
        }
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

function computeRecordCid(record: Post) {
  return cidForLex(record as unknown as LexValue)
}

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

function buildEmbedFromBlobs(
  blobs: DownloadedBlob[],
): Post['embed'] | undefined {
  if (blobs.length === 0) {
    return undefined
  }

  const imageBlobs = blobs.filter((b) => isImageMimeType(b.blobRef.mimeType))
  const videoBlobs = blobs.filter((b) => isVideoMimeType(b.blobRef.mimeType))

  // Prefer images if we have them (Bluesky supports up to 4 images)
  if (imageBlobs.length > 0) {
    const images = imageBlobs.slice(0, 4).map((blob) => ({
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
    const parentRef = {
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
  pdsClient: PDSClient,
  identifier: string,
  embed: unknown,
): Document[] {
  const attachments: Document[] = []

  if (!embed) {
    return attachments
  }

  if (isEmbedImages(embed)) {
    for (const img of embed.images) {
      const blobRef = BlobRef.asBlobRef(
        'original' in img.image ? img.image.original : img.image,
      )
      if (blobRef) {
        const url = pdsClient.getBlobUrl(identifier, blobRef.ref.toString())
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
    const blobRef = BlobRef.asBlobRef(
      'original' in embed.video ? embed.video.original : embed.video,
    )
    if (blobRef) {
      const url = pdsClient.getBlobUrl(identifier, blobRef.ref.toString())
      attachments.push(
        new Document({
          url: new URL(url),
          mediaType: blobRef.mimeType,
          name: embed.alt || '',
        }),
      )
    }
  }

  return attachments
}

function buildLinkFacets(text: string, links: CollectedLink[]): Facet[] {
  const richText = new RichText({ text })
  const facets: Facet[] = []
  let searchFromIndex = 0

  for (const link of links) {
    if (link.isMention) {
      continue
    }

    const foundIndex = text.indexOf(link.textContent, searchFromIndex)
    if (foundIndex !== -1) {
      const byteStart = richText.unicodeText.utf16IndexToUtf8Index(foundIndex)
      const byteEnd = richText.unicodeText.utf16IndexToUtf8Index(
        foundIndex + link.textContent.length,
      )

      facets.push({
        index: {
          byteStart,
          byteEnd,
        },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: link.href,
          },
        ],
      })

      searchFromIndex = foundIndex + link.textContent.length
    }
  }

  return facets
}

/**
 * Parse an ActivityPub actor URL to extract the DID.
 * Our bridge uses URLs in the format: https://hostname/users/{did}
 */
function extractDidFromActorUrl(actorUrl: string): string | null {
  try {
    const url = new URL(actorUrl)
    const pathMatch = url.pathname.match(/^\/users\/(.+)$/)
    if (pathMatch) {
      const identifier = pathMatch[1]
      // Check if it looks like a DID
      if (identifier.startsWith('did:')) {
        return identifier
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Build ATProto mention facets from collected links that are mentions.
 * Only creates facets for mentions that resolve to local PDS users.
 */
async function buildMentionFacetsFromLinks(
  text: string,
  links: Array<{ href: string; textContent: string; isMention: boolean }>,
  pdsClient?: PDSClient,
): Promise<Facet[]> {
  const mentions = links.filter((link) => link.isMention)
  if (!pdsClient || mentions.length === 0) {
    return []
  }

  const facets: Facet[] = []
  const richText = new RichText({ text })
  let searchFromIndex = 0

  for (const mention of mentions) {
    const did = extractDidFromActorUrl(mention.href)
    if (!did) {
      continue
    }

    if (!(await isLocalUser(pdsClient, did))) {
      continue
    }

    const foundIndex = text.indexOf(mention.textContent, searchFromIndex)
    if (foundIndex === -1) {
      continue
    }

    const byteStart = richText.unicodeText.utf16IndexToUtf8Index(foundIndex)
    const byteEnd = richText.unicodeText.utf16IndexToUtf8Index(
      foundIndex + mention.textContent.length,
    )

    facets.push({
      index: {
        byteStart,
        byteEnd,
      },
      features: [
        {
          $type: 'app.bsky.richtext.facet#mention',
          did,
        },
      ],
    })

    searchFromIndex = foundIndex + mention.textContent.length
  }

  return facets
}
