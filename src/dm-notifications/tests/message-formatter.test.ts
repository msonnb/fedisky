import { describe, it, expect } from 'vitest'
import { formatNotificationMessage, PostEngagement } from '../message-formatter'

describe('formatNotificationMessage', () => {
  it('should format a single like', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: 'Hello world!',
        likes: ['@alice@mastodon.social'],
        reposts: [],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toBe(
      [
        'Your post received Fediverse engagement:',
        '',
        '"Hello world!"',
        '  1 like from @alice@mastodon.social',
      ].join('\n'),
    )
  })

  it('should format multiple likes', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: 'Hello world!',
        likes: ['@alice@mastodon.social', '@bob@fosstodon.org'],
        reposts: [],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toContain(
      '2 likes from @alice@mastodon.social, @bob@fosstodon.org',
    )
  })

  it('should format a single repost', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: 'Hello world!',
        likes: [],
        reposts: ['@charlie@pixelfed.social'],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toContain('1 repost from @charlie@pixelfed.social')
  })

  it('should format both likes and reposts', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: 'Hello world!',
        likes: ['@alice@mastodon.social', '@bob@fosstodon.org'],
        reposts: ['@charlie@pixelfed.social'],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toContain('2 likes from')
    expect(result).toContain('1 repost from')
  })

  it('should truncate long post text', () => {
    const longText =
      'This is a very long post that exceeds the maximum allowed character limit for preview text in notifications'
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: longText,
        likes: ['@alice@mastodon.social'],
        reposts: [],
      },
    ]

    const result = formatNotificationMessage(posts)

    // Should be truncated with ...
    expect(result).toContain('...')
    // The text in quotes should be at most 60 chars
    const match = result.match(/"([^"]*)"/)
    expect(match).toBeTruthy()
    expect(match![1].length).toBeLessThanOrEqual(60)
  })

  it('should show (post) when text is null', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: null,
        likes: ['@alice@mastodon.social'],
        reposts: [],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toContain('"(post)"')
  })

  it('should truncate actor list beyond 3 names', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: 'Hello!',
        likes: [
          '@alice@mastodon.social',
          '@bob@fosstodon.org',
          '@charlie@pixelfed.social',
          '@dave@mstdn.io',
          '@eve@social.coop',
        ],
        reposts: [],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toContain('5 likes from')
    expect(result).toContain('@alice@mastodon.social')
    expect(result).toContain('@bob@fosstodon.org')
    expect(result).toContain('@charlie@pixelfed.social')
    expect(result).toContain('and 2 others')
    expect(result).not.toContain('@dave@mstdn.io')
  })

  it('should say "and 1 other" for 4 actors', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: 'Hello!',
        likes: [
          '@alice@mastodon.social',
          '@bob@fosstodon.org',
          '@charlie@pixelfed.social',
          '@dave@mstdn.io',
        ],
        reposts: [],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toContain('and 1 other')
  })

  it('should format multiple posts', () => {
    const posts: PostEngagement[] = [
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/abc',
        postText: 'First post',
        likes: ['@alice@mastodon.social'],
        reposts: [],
      },
      {
        postAtUri: 'at://did:plc:test/app.bsky.feed.post/def',
        postText: 'Second post',
        likes: [],
        reposts: ['@bob@fosstodon.org'],
      },
    ]

    const result = formatNotificationMessage(posts)

    expect(result).toContain('"First post"')
    expect(result).toContain('"Second post"')
    expect(result).toContain('1 like from @alice@mastodon.social')
    expect(result).toContain('1 repost from @bob@fosstodon.org')
  })
})
