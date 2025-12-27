import { RecordConverter } from './registry'
import type { Record as PostRecord } from '../../lexicon/types/app/bsky/feed/post'
import { LocalViewer } from '../../read-after-write/viewer'
import {
  isMain as isEmbedImages,
  type Main as EmbedImages,
} from '../../lexicon/types/app/bsky/embed/images'
import {
  isMain as isEmbedVideo,
  type Main as EmbedVideo,
} from '../../lexicon/types/app/bsky/embed/video'
import { BlobRef } from '@atproto/lexicon'
import {
  Collection,
  Create,
  Document,
  LanguageString,
  Note,
  PUBLIC_COLLECTION,
} from '@fedify/fedify'
import { Temporal } from '@js-temporal/polyfill'
import { AtUri } from '@atproto/syntax'

export const postConverter: RecordConverter<PostRecord> = {
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
      const blobRef = BlobRef.asBlobRef(img.image)
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
    const blobRef = BlobRef.asBlobRef(videoEmbed.video)
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
