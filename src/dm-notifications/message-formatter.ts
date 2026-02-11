const MAX_POST_TEXT_LENGTH = 60
const MAX_ACTOR_NAMES = 3

export interface PostEngagement {
  postAtUri: string
  postText: string | null
  likes: string[] // actor display names like @alice@mastodon.social
  reposts: string[] // actor display names
}

export function formatNotificationMessage(posts: PostEngagement[]): string {
  const lines: string[] = ['Your post received Fediverse engagement:']

  for (const post of posts) {
    lines.push('')
    const preview = post.postText
      ? truncateText(post.postText, MAX_POST_TEXT_LENGTH)
      : '(post)'
    lines.push(`"${preview}"`)

    if (post.likes.length > 0) {
      const names = formatActorList(post.likes)
      const noun = post.likes.length === 1 ? 'like' : 'likes'
      lines.push(`  ${post.likes.length} ${noun} from ${names}`)
    }

    if (post.reposts.length > 0) {
      const names = formatActorList(post.reposts)
      const noun = post.reposts.length === 1 ? 'repost' : 'reposts'
      lines.push(`  ${post.reposts.length} ${noun} from ${names}`)
    }
  }

  return lines.join('\n')
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

function formatActorList(actors: string[]): string {
  if (actors.length <= MAX_ACTOR_NAMES) {
    return actors.join(', ')
  }
  const shown = actors.slice(0, MAX_ACTOR_NAMES)
  const remaining = actors.length - MAX_ACTOR_NAMES
  return `${shown.join(', ')} and ${remaining} ${remaining === 1 ? 'other' : 'others'}`
}
