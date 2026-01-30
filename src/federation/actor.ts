import { BlobRef } from '@atproto/lexicon'
import {
  Endpoints,
  exportJwk,
  generateCryptoKeyPair,
  Image,
  importJwk,
  Person,
} from '@fedify/fedify'
import { AppContext } from '../context'
import { apLogger } from '../logger'

export function setupActorDispatcher(ctx: AppContext) {
  ctx.federation
    .setActorDispatcher(`/users/{+identifier}`, async (fedCtx, identifier) => {
      try {
        if (identifier.includes('/')) {
          apLogger.debug({ identifier }, 'invalid actor identifier contains /')
          return null
        }

        // Hide the bridge account from ActivityPub - it should not be discoverable
        if (
          ctx.bridgeAccount.isAvailable() &&
          identifier === ctx.bridgeAccount.did
        ) {
          apLogger.debug(
            { identifier },
            'hiding bridge account from actor dispatcher',
          )
          return null
        }

        const account = await ctx.pdsClient.getAccount(identifier)
        if (!account || !account.handle) {
          apLogger.debug({ identifier }, 'actor not found or missing handle')
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
        apLogger.debug(
          { identifier, handle: account.handle },
          'dispatching actor',
        )
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
        apLogger.warn({ err, identifier }, 'failed to dispatch actor')
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
            { username, handle },
            'hiding bridge account from handle mapping',
          )
          return null
        }

        const did = await ctx.pdsClient.resolveHandle(handle)
        if (!did) {
          apLogger.debug(
            { username, handle },
            'handle mapping failed: account not found',
          )
          return null
        }

        // Double-check: also hide if resolved DID is the bridge account
        if (ctx.bridgeAccount.isAvailable() && did === ctx.bridgeAccount.did) {
          apLogger.debug(
            { username, handle, did },
            'hiding bridge account from handle mapping (by DID)',
          )
          return null
        }

        apLogger.debug({ username, handle, did }, 'mapped handle to did')
        return did
      } catch (err) {
        apLogger.warn({ err, username }, 'failed to map handle')
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
            { identifier },
            'not providing keypairs for bridge account',
          )
          return []
        }

        let rsaKeypair = await ctx.db.getKeyPair(
          identifier,
          'RSASSA-PKCS1-v1_5',
        )
        let ed25519Keypair = await ctx.db.getKeyPair(identifier, 'Ed25519')

        if (!rsaKeypair) {
          apLogger.info({ identifier }, 'generating new RSA keypair')
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
          apLogger.info({ identifier }, 'generating new Ed25519 keypair')
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

        apLogger.debug({ identifier }, 'dispatched keypairs')
        return pairs
      } catch (err) {
        apLogger.warn({ err, identifier }, 'failed to dispatch keypairs')
        return []
      }
    })
}
