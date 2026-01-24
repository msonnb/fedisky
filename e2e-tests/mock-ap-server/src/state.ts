/**
 * In-memory state store for the mock ActivityPub server
 */

export interface StoredActivity {
  id: string
  type: string
  actor: string
  object?: unknown
  target?: string
  receivedAt: string
  recipient: string
  raw: unknown
}

export interface FollowState {
  actorUri: string
  actorInbox: string
  followedAt: string
}

export interface State {
  /** All received activities, keyed by recipient username */
  inbox: Map<string, StoredActivity[]>
  /** Accounts this server's users are following (outbound follows) */
  following: Map<string, FollowState[]>
  /** Accounts following this server's users (inbound follows) */
  followers: Map<string, FollowState[]>
  /** Counter for generating activity IDs */
  activityCounter: number
}

export function createState(): State {
  return {
    inbox: new Map(),
    following: new Map(),
    followers: new Map(),
    activityCounter: 0,
  }
}

export function resetState(state: State): void {
  state.inbox.clear()
  state.following.clear()
  state.followers.clear()
  state.activityCounter = 0
}

export function addInboxActivity(
  state: State,
  recipient: string,
  activity: StoredActivity,
): void {
  if (!state.inbox.has(recipient)) {
    state.inbox.set(recipient, [])
  }
  state.inbox.get(recipient)!.push(activity)
}

export function getInboxActivities(
  state: State,
  recipient?: string,
  type?: string,
): StoredActivity[] {
  let activities: StoredActivity[] = []

  if (recipient) {
    activities = state.inbox.get(recipient) || []
  } else {
    for (const items of state.inbox.values()) {
      activities.push(...items)
    }
  }

  if (type) {
    activities = activities.filter((a) => a.type === type)
  }

  return activities.sort(
    (a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  )
}

export function addFollower(
  state: State,
  username: string,
  actorUri: string,
  actorInbox: string,
): void {
  if (!state.followers.has(username)) {
    state.followers.set(username, [])
  }
  const followers = state.followers.get(username)!
  if (!followers.some((f) => f.actorUri === actorUri)) {
    followers.push({
      actorUri,
      actorInbox,
      followedAt: new Date().toISOString(),
    })
  }
}

export function removeFollower(
  state: State,
  username: string,
  actorUri: string,
): void {
  const followers = state.followers.get(username)
  if (followers) {
    const idx = followers.findIndex((f) => f.actorUri === actorUri)
    if (idx !== -1) {
      followers.splice(idx, 1)
    }
  }
}

export function getFollowers(state: State, username: string): FollowState[] {
  return state.followers.get(username) || []
}

export function addFollowing(
  state: State,
  username: string,
  actorUri: string,
  actorInbox: string,
): void {
  if (!state.following.has(username)) {
    state.following.set(username, [])
  }
  const following = state.following.get(username)!
  if (!following.some((f) => f.actorUri === actorUri)) {
    following.push({
      actorUri,
      actorInbox,
      followedAt: new Date().toISOString(),
    })
  }
}

export function removeFollowing(
  state: State,
  username: string,
  actorUri: string,
): void {
  const following = state.following.get(username)
  if (following) {
    const idx = following.findIndex((f) => f.actorUri === actorUri)
    if (idx !== -1) {
      following.splice(idx, 1)
    }
  }
}

export function getFollowing(state: State, username: string): FollowState[] {
  return state.following.get(username) || []
}

export function nextActivityId(state: State): number {
  return ++state.activityCounter
}
