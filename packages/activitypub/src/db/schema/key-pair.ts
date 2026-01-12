export interface APKeyPair {
  userDid: string
  type: 'RSASSA-PKCS1-v1_5' | 'Ed25519'
  publicKey: string
  privateKey: string
  createdAt: string
}

export const tableName = 'ap_key_pair'

export interface PartialDB {
  [tableName]: APKeyPair
}
