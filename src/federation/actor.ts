import { BlobRef } from '@atproto/lexicon'
import { ensureValidDid } from '@atproto/syntax'
import { exportJwk, generateCryptoKeyPair, importJwk } from '@fedify/fedify'
import { Endpoints, Image, Person } from '@fedify/vocab'
import { AppContext } from '../context'
import { getWideEvent } from '../logging'

export function setupActorDispatcher(ctx: AppContext) {
  ctx.federation
    .setActorDispatcher(`/users/{+identifier}`, async (fedCtx, identifier) => {
      const event = getWideEvent()
      event?.set('actor.identifier', identifier)
      event?.set('dispatch.type', 'actor')

      try {
        // Validate DID format using ATProto syntax validation
        try {
          ensureValidDid(identifier)
        } catch {
          event?.set('dispatch.result', 'invalid_did')
          return null
        }

        // Hide the mastodon bridge account from ActivityPub - it should not be discoverable
        if (
          ctx.mastodonBridgeAccount.isAvailable() &&
          identifier === ctx.mastodonBridgeAccount.did
        ) {
          event?.set('dispatch.result', 'hidden_bridge_account')
          return null
        }

        const account = await ctx.pdsClient.getAccount(identifier)
        if (!account || !account.handle) {
          event?.set('dispatch.result', 'not_found')
          return null
        }

        event?.set('actor.handle', account.handle)

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
        event?.set('dispatch.result', 'success')

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
        event?.setError(err instanceof Error ? err : new Error(String(err)))
        event?.set('dispatch.result', 'error')
        return null
      }
    })
    .mapHandle(async (fedCtx, username) => {
      const event = getWideEvent()
      event?.set('dispatch.type', 'handle_mapping')
      event?.set('actor.username', username)

      try {
        const hostname = ctx.cfg.service.hostname
        const handle = `${username}.${hostname === 'localhost' ? 'test' : hostname}`
        event?.set('actor.handle', handle)

        // Hide the mastodon bridge account from ActivityPub handle mapping
        if (
          ctx.mastodonBridgeAccount.isAvailable() &&
          username === ctx.cfg.mastodonBridge.handle
        ) {
          event?.set('dispatch.result', 'hidden_bridge_account')
          return null
        }

        const did = await ctx.pdsClient.resolveHandle(handle)
        if (!did) {
          event?.set('dispatch.result', 'not_found')
          return null
        }

        // Double-check: also hide if resolved DID is the mastodon bridge account
        if (
          ctx.mastodonBridgeAccount.isAvailable() &&
          did === ctx.mastodonBridgeAccount.did
        ) {
          event?.set('dispatch.result', 'hidden_bridge_account')
          return null
        }

        event?.set('actor.did', did)
        event?.set('dispatch.result', 'success')
        return did
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
        event?.set('dispatch.result', 'error')
        return null
      }
    })
    .setKeyPairsDispatcher(async (fedCtx, identifier) => {
      const event = getWideEvent()
      event?.set('dispatch.type', 'keypairs')
      event?.set('actor.identifier', identifier)

      try {
        // Don't generate/return keypairs for the mastodon bridge account
        if (
          ctx.mastodonBridgeAccount.isAvailable() &&
          identifier === ctx.mastodonBridgeAccount.did
        ) {
          event?.set('dispatch.result', 'hidden_bridge_account')
          return []
        }

        let rsaKeypair = await ctx.db.getKeyPair(
          identifier,
          'RSASSA-PKCS1-v1_5',
        )
        let ed25519Keypair = await ctx.db.getKeyPair(identifier, 'Ed25519')

        if (!rsaKeypair) {
          event?.set('keypairs.rsa_generated', true)
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
          event?.set('keypairs.ed25519_generated', true)
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

        event?.set('dispatch.result', 'success')
        return pairs
      } catch (err) {
        event?.setError(err instanceof Error ? err : new Error(String(err)))
        event?.set('dispatch.result', 'error')
        return []
      }
    })
}
