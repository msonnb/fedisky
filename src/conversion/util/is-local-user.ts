import { PDSClient } from '../../pds-client'

export async function isLocalUser(
  pdsClient: PDSClient,
  did: string,
): Promise<boolean> {
  try {
    const account = await pdsClient.getAccount(did)
    return account !== null
  } catch {
    return false
  }
}
