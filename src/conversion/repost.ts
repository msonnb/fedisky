import type { Main as Repost } from '@atproto/api/dist/client/types/app/bsky/feed/repost'
import { AtUri } from '@atproto/syntax'
import { Announce, Note, PUBLIC_COLLECTION } from '@fedify/vocab'
import { Temporal } from '@js-temporal/polyfill'
import { apLogger } from '../logger'
import { RecordConverter } from './registry'
import { isLocalUser } from './util/is-local-user'

export const repostConverter: RecordConverter<Repost, Note> = {
  collection: 'app.bsky.feed.repost',

  async toActivityPub(ctx, identifier, record, pdsClient, _options) {
    const repost = record.value
    const subjectUri = repost.subject.uri
    const subjectAtUri = new AtUri(subjectUri)
    const subjectDid = subjectAtUri.hostname

    // Check if the subject post is from a local user on this PDS
    // We only generate Announce activities for reposts of local posts
    const isLocalPost = await isLocalUser(pdsClient, subjectDid)
    if (!isLocalPost) {
      apLogger.debug(
        'skipping repost of external post (not on this PDS): {repostUri} {subjectUri} {subjectDid}',
        {
          repostUri: record.uri,
          subjectUri,
          subjectDid,
        },
      )
      return null
    }

    const actor = ctx.getActorUri(identifier)
    const followersUri = ctx.getFollowersUri(identifier)
    const subjectNoteId = ctx.getObjectUri(Note, { uri: subjectUri })
    const announceId = new URL(
      `/reposts/${encodeURIComponent(record.uri)}`,
      ctx.origin,
    )

    const published = Temporal.Instant.from(repost.createdAt)

    const announce = new Announce({
      id: announceId,
      actor,
      to: PUBLIC_COLLECTION,
      cc: followersUri,
      object: subjectNoteId,
      published,
    })

    apLogger.debug(
      'converted repost to Announce activity: {repostUri} {subjectUri} {announceId}',
      {
        repostUri: record.uri,
        subjectUri,
        announceId: announceId.href,
      },
    )

    return {
      object: null,
      activity: announce,
    }
  },

  async toRecord() {
    return null
  },
}
