export interface APMonitoredPost {
  atUri: string
  authorDid: string
  lastChecked: string | null
  createdAt: string
}

export const tableName = 'ap_monitored_post'

export interface PartialDB {
  [tableName]: APMonitoredPost
}
