export interface APBridgeAccount {
  id: number // Always 1 - singleton
  did: string
  handle: string
  password: string
  accessJwt: string
  refreshJwt: string
  createdAt: string
  updatedAt: string
}

export const tableName = 'ap_bridge_account'

export interface PartialDB {
  [tableName]: APBridgeAccount
}
