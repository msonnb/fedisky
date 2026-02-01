import type { Main as LikeRecord } from '@atproto/api/dist/client/types/app/bsky/feed/like'
import { AtUri } from '@atproto/syntax'
import { Like, Note, PUBLIC_COLLECTION } from '@fedify/vocab'
import { Temporal } from '@js-temporal/polyfill'
import { apLogger } from '../logger'
import { RecordConverter } from './registry'
import { isLocalUser } from './util/is-local-user'

export const likeConverter: RecordConverter<LikeRecord, Note> = {
  collection: 'app.bsky.feed.like',

  async toActivityPub(ctx, identifier, record, pdsClient, _options) {
    const like = record.value
    const subjectUri = like.subject.uri
    const subjectAtUri = new AtUri(subjectUri)
    const subjectDid = subjectAtUri.hostname

    // Check if the subject post is from a local user on this PDS
    // We only generate Like activities for likes of local posts
    const isLocalPost = await isLocalUser(pdsClient, subjectDid)
    if (!isLocalPost) {
      apLogger.debug(
        'skipping like of external post (not on this PDS): {likeUri} {subjectUri} {subjectDid}',
        {
          likeUri: record.uri,
          subjectUri,
          subjectDid,
        },
      )
      return null
    }

    const actor = ctx.getActorUri(identifier)
    const followersUri = ctx.getFollowersUri(identifier)
    const subjectNoteId = ctx.getObjectUri(Note, { uri: subjectUri })
    const likeId = new URL(
      `/likes/${encodeURIComponent(record.uri)}`,
      ctx.origin,
    )

    const published = Temporal.Instant.from(like.createdAt)

    const activity = new Like({
      id: likeId,
      actor,
      to: PUBLIC_COLLECTION,
      cc: followersUri,
      object: subjectNoteId,
      published,
    })

    apLogger.debug(
      'converted like to Like activity: {likeUri} {subjectUri} {likeId}',
      {
        likeUri: record.uri,
        subjectUri,
        likeId: likeId.href,
      },
    )

    return {
      object: null,
      activity,
    }
  },

  async toRecord() {
    return null
  },
}
