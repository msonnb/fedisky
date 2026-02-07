/**
 * API routes for mock Constellation server
 *
 * Provides both Constellation API endpoints and AppView mock endpoints
 * for testing external Bluesky reply federation.
 */

import type { Router } from 'express'
import { Router as createRouter } from 'express'
import type { Config } from './config'
import {
  getReplyByUri,
  getReplyByAuthorDid,
  getRepliesForPost,
  resetState,
  seedReply,
  type State,
} from './state'

export function createApiRouter(config: Config, state: State): Router {
  const router = createRouter()

  // Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // ============================================================
  // Constellation API endpoints
  // ============================================================

  /**
   * GET /xrpc/blue.microcosm.links.getBacklinks
   *
   * Returns backlinks (replies) to a given subject.
   * Query params:
   *   - subject: AT URI of the post to find replies to
   *   - source: e.g., "app.bsky.feed.post:reply.parent.uri"
   *   - limit: max number of results
   */
  router.get('/xrpc/blue.microcosm.links.getBacklinks', (req, res) => {
    const subject = req.query.subject as string | undefined
    const source = req.query.source as string | undefined

    if (!subject) {
      res.status(400).json({ error: 'subject parameter required' })
      return
    }

    // Only handle reply backlinks
    if (source && !source.includes('reply.parent.uri')) {
      res.json({ backlinks: [] })
      return
    }

    const replies = getRepliesForPost(state, subject)
    const records = replies.map((r) => {
      // Parse AT URI: at://did/collection/rkey
      const parts = r.replyAtUri.replace('at://', '').split('/')
      return {
        did: parts[0],
        collection: parts[1],
        rkey: parts[2],
      }
    })

    console.log(
      `[constellation] getBacklinks subject=${subject} found=${records.length}`,
    )

    res.json({ total: records.length, records, cursor: null })
  })

  // ============================================================
  // AppView mock endpoints
  // ============================================================

  /**
   * GET /xrpc/com.atproto.repo.getRecord
   *
   * Returns a record from a repo. Used by Fedisky to fetch:
   *   - External reply post content
   *   - External user profile
   */
  router.get('/xrpc/com.atproto.repo.getRecord', (req, res) => {
    const repo = req.query.repo as string | undefined
    const collection = req.query.collection as string | undefined
    const rkey = req.query.rkey as string | undefined

    if (!repo || !collection || !rkey) {
      res.status(400).json({ error: 'repo, collection, and rkey required' })
      return
    }

    const uri = `at://${repo}/${collection}/${rkey}`

    // Handle profile requests
    if (collection === 'app.bsky.actor.profile' && rkey === 'self') {
      const reply = getReplyByAuthorDid(state, repo)
      if (reply) {
        console.log(`[constellation] getRecord profile for ${repo}`)
        res.json({
          uri,
          cid: `bafyprofile${Date.now()}`,
          value: {
            $type: 'app.bsky.actor.profile',
            displayName: reply.replyAuthorHandle.split('.')[0],
            handle: reply.replyAuthorHandle,
          },
        })
        return
      }
      // Return a generic profile for unknown DIDs
      res.json({
        uri,
        cid: `bafyprofile${Date.now()}`,
        value: {
          $type: 'app.bsky.actor.profile',
          displayName: 'Unknown User',
        },
      })
      return
    }

    // Handle post requests
    if (collection === 'app.bsky.feed.post') {
      const reply = getReplyByUri(state, uri)
      if (reply) {
        console.log(`[constellation] getRecord post ${uri}`)
        res.json({
          uri: reply.replyAtUri,
          cid: reply.replyCid,
          value: {
            $type: 'app.bsky.feed.post',
            text: reply.replyText,
            createdAt: reply.replyCreatedAt,
            reply: {
              root: { uri: reply.parentAtUri, cid: 'bafyrootcid' },
              parent: { uri: reply.parentAtUri, cid: 'bafyparentcid' },
            },
          },
        })
        return
      }
    }

    console.log(`[constellation] getRecord not found: ${uri}`)
    res.status(404).json({ error: 'RecordNotFound' })
  })

  /**
   * GET /xrpc/com.atproto.identity.resolveHandle
   *
   * Resolves a handle to a DID.
   */
  router.get('/xrpc/com.atproto.identity.resolveHandle', (req, res) => {
    const handle = req.query.handle as string | undefined

    if (!handle) {
      res.status(400).json({ error: 'handle parameter required' })
      return
    }

    // Find a seeded reply with this handle
    const reply = state.replies.find((r) => r.replyAuthorHandle === handle)
    if (reply) {
      console.log(
        `[constellation] resolveHandle ${handle} -> ${reply.replyAuthorDid}`,
      )
      res.json({ did: reply.replyAuthorDid })
      return
    }

    console.log(`[constellation] resolveHandle not found: ${handle}`)
    res.status(404).json({ error: 'HandleNotFound' })
  })

  // ============================================================
  // Test control endpoints
  // ============================================================

  /**
   * POST /api/seed-reply
   *
   * Seed a fake external reply for testing.
   */
  router.post('/api/seed-reply', (req, res) => {
    const {
      parentAtUri,
      replyAtUri,
      replyAuthorDid,
      replyAuthorHandle,
      replyText,
    } = req.body as {
      parentAtUri?: string
      replyAtUri?: string
      replyAuthorDid?: string
      replyAuthorHandle?: string
      replyText?: string
    }

    if (
      !parentAtUri ||
      !replyAtUri ||
      !replyAuthorDid ||
      !replyAuthorHandle ||
      !replyText
    ) {
      res.status(400).json({
        error:
          'parentAtUri, replyAtUri, replyAuthorDid, replyAuthorHandle, and replyText required',
      })
      return
    }

    const seeded = seedReply(state, {
      parentAtUri,
      replyAtUri,
      replyAuthorDid,
      replyAuthorHandle,
      replyText,
    })

    console.log(
      `[constellation] seeded reply: ${replyAtUri} -> ${parentAtUri} by ${replyAuthorHandle}`,
    )

    res.json({ success: true, reply: seeded })
  })

  /**
   * GET /api/replies
   *
   * Get all seeded replies (for debugging).
   */
  router.get('/api/replies', (_req, res) => {
    res.json(state.replies)
  })

  /**
   * DELETE /api/reset
   *
   * Reset all state.
   */
  router.delete('/api/reset', (_req, res) => {
    resetState(state)
    console.log('[constellation] state reset')
    res.json({ success: true })
  })

  return router
}
