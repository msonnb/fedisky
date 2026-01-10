import * as plc from '@did-plc/lib'
import { Secp256k1Keypair } from '@atproto/crypto'
import { AccountStatus } from './account-manager/helpers/account'
import { AppContext } from './context'
import { httpLogger } from './logger'
import { syncEvtDataFromCommit } from './repo'

const SERVICE_HANDLE = 'mastodon'

/**
 * Ensures the @mastodon service account exists on PDS startup.
 * This account is used for ActivityPub federation.
 */
export async function ensureServiceAccount(ctx: AppContext): Promise<void> {
  const serviceHandleDomain = ctx.cfg.identity.serviceHandleDomains[0]
  if (!serviceHandleDomain) {
    httpLogger.warn(
      'No service handle domain configured, skipping service account creation',
    )
    return
  }

  const handle = `${SERVICE_HANDLE}${serviceHandleDomain}`

  // Check if the account already exists
  const existingAccount = await ctx.accountManager.getAccount(handle, {
    includeDeactivated: true,
    includeTakenDown: true,
  })

  if (existingAccount) {
    httpLogger.info(
      { handle, did: existingAccount.did },
      'Service account already exists',
    )
    return
  }

  httpLogger.info({ handle }, 'Creating service account')

  // Create a signing key for the service account
  const signingKey = await Secp256k1Keypair.create({ exportable: true })

  // Create PLC operation
  const rotationKeys = [ctx.plcRotationKey.did()]
  if (ctx.cfg.identity.recoveryDidKey) {
    rotationKeys.unshift(ctx.cfg.identity.recoveryDidKey)
  }

  const plcCreate = await plc.createOp({
    signingKey: signingKey.did(),
    rotationKeys,
    handle,
    pds: ctx.cfg.service.publicUrl,
    signer: ctx.plcRotationKey,
  })

  const { did, op: plcOp } = plcCreate

  // Create the actor store and repo
  await ctx.actorStore.create(did, signingKey)
  try {
    const commit = await ctx.actorStore.transact(did, (actorTxn) =>
      actorTxn.repo.createRepo([]),
    )

    // Register the DID with PLC
    try {
      await ctx.plcClient.sendOperation(did, plcOp)
    } catch (err) {
      httpLogger.error(
        { didKey: ctx.plcRotationKey.did(), handle, err },
        'Failed to create did:plc for service account',
      )
      throw err
    }

    // Create the account in the account manager (no email/password for service account)
    await ctx.accountManager.createAccount({
      did,
      handle,
      repoCid: commit.cid,
      repoRev: commit.rev,
    })

    // Sequence the events
    await ctx.sequencer.sequenceIdentityEvt(did, handle)
    await ctx.sequencer.sequenceAccountEvt(did, AccountStatus.Active)
    await ctx.sequencer.sequenceCommit(did, commit)
    await ctx.sequencer.sequenceSyncEvt(did, syncEvtDataFromCommit(commit))

    await ctx.accountManager.updateRepoRoot(did, commit.cid, commit.rev)

    httpLogger.info({ handle, did }, 'Service account created successfully')
  } catch (err) {
    // Clean up on failure
    await ctx.actorStore.destroy(did)
    throw err
  }
}
