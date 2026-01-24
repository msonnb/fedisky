/**
 * Configuration for mock ActivityPub server
 */

export interface Config {
  hostname: string
  port: number
  users: string[]
  /** Base URL for generating ActivityPub URIs (e.g., "http://mastodon.test") */
  baseUrl: string
}

export function loadConfig(): Config {
  const hostname = process.env.AP_HOSTNAME || 'mastodon.test'
  const port = parseInt(process.env.AP_PORT || '3000', 10)
  const usersEnv = process.env.AP_USERS || 'alice,bob'
  const users = usersEnv
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  // Allow explicit override via AP_PUBLIC_URL, otherwise default to http
  const baseUrl = process.env.AP_PUBLIC_URL || `http://${hostname}`

  return { hostname, port, users, baseUrl }
}
