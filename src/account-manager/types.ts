export interface BridgeAccountConfig {
  handle: string
  email: string
  displayName: string
  description: string
  avatarUrl?: string
}

export interface BridgeAccountData {
  did: string
  handle: string
  password: string
  accessJwt: string
  refreshJwt: string
  createdAt: string
  updatedAt: string
}

export interface AccountDatabaseOps {
  get(): Promise<BridgeAccountData | undefined>
  save(data: Omit<BridgeAccountData, 'id'>): Promise<BridgeAccountData>
  updateTokens(accessJwt: string, refreshJwt: string): Promise<void>
  delete(): Promise<void>
}
