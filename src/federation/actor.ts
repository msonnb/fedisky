import { BlobRef } from '@atproto/lexicon'
import { ensureValidDid } from '@atproto/syntax'
import { exportJwk, generateCryptoKeyPair, importJwk } from '@fedify/fedify'
import { Endpoints, Image, Person } from '@fedify/vocab'
import { AppContext } from '../context'
import { apLogger } from '../logger'

export function setupActorDispatcher(ctx: AppContext) {
  ctx.federation
    .setActorDispatcher(`/users/{+identifier}`, async (fedCtx, identifier) => {
      try {
        // Validate DID format using ATProto syntax validation
        try {
          ensureValidDid(identifier)
        } catch {
          apLogger.debug('invalid DID format: {identifier}', { identifier })
          return null
        }

        // Hide the bridge account from ActivityPub - it should not be discoverable
        if (
          ctx.bridgeAccount.isAvailable() &&
          identifier === ctx.bridgeAccount.did
        ) {
          apLogger.debug(
            'hiding bridge account from actor dispatcher: {identifier}',
            {
              identifier,
            },
          )
          return null
        }

        const account = await ctx.pdsClient.getAccount(identifier)
        if (!account || !account.handle) {
          apLogger.debug('actor not found or missing handle: {identifier}', {
            identifier,
          })
          return null
        }

        const profile = await ctx.pdsClient.getProfile(identifier)

        const buildImage = (type: 'avatar' | 'banner', blob?: BlobRef) => {
          if (!blob) return undefined
          const url = ctx.pdsClient.getImageUrl(
            identifier,
            blob.ref.toString(),
            type,
          )
          return { url: new URL(url), mediaType: blob.mimeType }
        }

        const avatar = profile?.avatar
          ? buildImage('avatar', profile.avatar)
          : undefined
        const banner = profile?.banner
          ? buildImage('banner', profile.banner)
          : undefined

        const keyPairs = await fedCtx.getActorKeyPairs(identifier)
        apLogger.debug('dispatching actor: {identifier} {handle}', {
          identifier,
          handle: account.handle,
        })
        return new Person({
          id: fedCtx.getActorUri(identifier),
          alias: new URL(`at://${encodeURIComponent(account.did)}`),
          name: profile?.displayName,
          summary: profile?.description,
          preferredUsername: account.handle.split('.').at(0),
          icon: avatar
            ? new Image({
                url: avatar.url,
                mediaType: avatar.mediaType,
              })
            : undefined,
          image: banner
            ? new Image({
                url: banner.url,
                mediaType: banner.mediaType,
              })
            : undefined,
          url: new URL(account.handle, 'https://bsky.app/profile/'),
          inbox: fedCtx.getInboxUri(identifier),
          outbox: fedCtx.getOutboxUri(identifier),
          followers: fedCtx.getFollowersUri(identifier),
          following: fedCtx.getFollowingUri(identifier),
          endpoints: new Endpoints({
            sharedInbox: fedCtx.getInboxUri(),
          }),
          publicKey: keyPairs[0].cryptographicKey,
          assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
        })
      } catch (err) {
        apLogger.warn('failed to dispatch actor: {identifier} {err}', {
          err,
          identifier,
        })
        return null
      }
    })
    .mapHandle(async (fedCtx, username) => {
      try {
        const hostname = ctx.cfg.service.hostname
        const handle = `${username}.${hostname === 'localhost' ? 'test' : hostname}`

        // Hide the bridge account from ActivityPub handle mapping
        if (
          ctx.bridgeAccount.isAvailable() &&
          username === ctx.cfg.bridge.handle
        ) {
          apLogger.debug(
            'hiding bridge account from handle mapping: {username} {handle}',
            {
              username,
              handle,
            },
          )
          return null
        }

        const did = await ctx.pdsClient.resolveHandle(handle)
        if (!did) {
          apLogger.debug(
            'handle mapping failed: account not found {username} {handle}',
            {
              username,
              handle,
            },
          )
          return null
        }

        // Double-check: also hide if resolved DID is the bridge account
        if (ctx.bridgeAccount.isAvailable() && did === ctx.bridgeAccount.did) {
          apLogger.debug(
            'hiding bridge account from handle mapping (by DID): {username} {handle} {did}',
            {
              username,
              handle,
              did,
            },
          )
          return null
        }

        apLogger.debug('mapped handle to did: {username} {handle} {did}', {
          username,
          handle,
          did,
        })
        return did
      } catch (err) {
        apLogger.warn('failed to map handle: {username} {err}', {
          err,
          username,
        })
        return null
      }
    })
    .setKeyPairsDispatcher(async (fedCtx, identifier) => {
      try {
        // Don't generate/return keypairs for the bridge account
        if (
          ctx.bridgeAccount.isAvailable() &&
          identifier === ctx.bridgeAccount.did
        ) {
          apLogger.debug(
            'not providing keypairs for bridge account: {identifier}',
            {
              identifier,
            },
          )
          return []
        }

        let rsaKeypair = await ctx.db.getKeyPair(
          identifier,
          'RSASSA-PKCS1-v1_5',
        )
        let ed25519Keypair = await ctx.db.getKeyPair(identifier, 'Ed25519')

        if (!rsaKeypair) {
          apLogger.info('generating new RSA keypair: {identifier}', {
            identifier,
          })
          const { publicKey, privateKey } =
            await generateCryptoKeyPair('RSASSA-PKCS1-v1_5')
          rsaKeypair = await ctx.db.createKeyPair({
            userDid: identifier,
            type: 'RSASSA-PKCS1-v1_5',
            publicKey: JSON.stringify(await exportJwk(publicKey)),
            privateKey: JSON.stringify(await exportJwk(privateKey)),
            createdAt: new Date().toISOString(),
          })
        }

        if (!ed25519Keypair) {
          apLogger.info('generating new Ed25519 keypair: {identifier}', {
            identifier,
          })
          const { publicKey, privateKey } =
            await generateCryptoKeyPair('Ed25519')
          ed25519Keypair = await ctx.db.createKeyPair({
            userDid: identifier,
            type: 'Ed25519',
            publicKey: JSON.stringify(await exportJwk(publicKey)),
            privateKey: JSON.stringify(await exportJwk(privateKey)),
            createdAt: new Date().toISOString(),
          })
        }

        const pairs = await Promise.all(
          [rsaKeypair, ed25519Keypair].map(async (keypair) => {
            return {
              privateKey: await importJwk(
                JSON.parse(keypair.privateKey),
                'private',
              ),
              publicKey: await importJwk(
                JSON.parse(keypair.publicKey),
                'public',
              ),
            }
          }),
        )

        apLogger.debug('dispatched keypairs: {identifier}', { identifier })
        return pairs
      } catch (err) {
        apLogger.warn('failed to dispatch keypairs: {identifier} {err}', {
          err,
          identifier,
        })
        return []
      }
    })
}
