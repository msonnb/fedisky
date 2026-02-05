/**
 * Environment characteristics for wide event logging.
 * These values are captured once at startup and included in every event.
 */

const packageVersion = process.env.npm_package_version || 'unknown'
const commitHash = process.env.COMMIT_SHA || process.env.GIT_SHA || 'unknown'
const nodeVersion = process.version

export interface EnvironmentInfo {
  service: string
  version: string
  commit_hash: string
  node_version: string
}

export const environment: EnvironmentInfo = {
  service: 'fedisky',
  version: packageVersion,
  commit_hash: commitHash,
  node_version: nodeVersion,
}
