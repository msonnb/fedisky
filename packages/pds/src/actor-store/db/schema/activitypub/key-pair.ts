export interface ActivityPubKeyPair {
  type: 'RSASSA-PKCS1-v1_5' | 'Ed25519'
  publicKey: string
  privateKey: string
  createdAt: string
}

export const tableName = 'activitypub_key_pair'

export type PartialDB = { [tableName]: ActivityPubKeyPair }
