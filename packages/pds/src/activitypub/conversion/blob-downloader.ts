import stream from 'node:stream'
import { BlobRef } from '@atproto/lexicon'
import type { BlobTransactor } from '../../actor-store/blob/transactor'
import { apLogger } from '../../logger'

export interface DownloadedBlob {
  blobRef: BlobRef
  width: number | null
  height: number | null
  alt: string
}

export interface AttachmentInfo {
  url: string
  mediaType?: string
  name?: string // alt text
}

/**
 * Download a remote blob and store it in the PDS blob store.
 * Returns a BlobRef that can be used in record embeds.
 */
export async function downloadAndStoreBlob(
  blobTransactor: BlobTransactor,
  attachment: AttachmentInfo,
): Promise<DownloadedBlob | null> {
  try {
    apLogger.debug({ url: attachment.url }, 'downloading remote blob')

    const response = await fetch(attachment.url, {
      headers: {
        Accept: attachment.mediaType || 'image/*,video/*,*/*',
        'User-Agent': 'Bluesky-PDS/1.0 (ActivityPub Federation)',
      },
    })

    if (!response.ok) {
      apLogger.warn(
        { url: attachment.url, status: response.status },
        'failed to fetch remote blob',
      )
      return null
    }

    const contentType =
      response.headers.get('content-type') ||
      attachment.mediaType ||
      'application/octet-stream'

    // Check content length to avoid downloading huge files
    const contentLength = response.headers.get('content-length')
    const maxSize = 10 * 1024 * 1024 // 10MB limit
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      apLogger.warn(
        { url: attachment.url, size: contentLength },
        'remote blob too large, skipping',
      )
      return null
    }

    const nodeStream = stream.Readable.fromWeb(
      response.body as ReadableStream<Uint8Array>,
    )

    const metadata = await blobTransactor.uploadBlobAndGetMetadata(
      contentType,
      nodeStream,
    )

    const blobRef = await blobTransactor.trackUntetheredBlob(metadata)

    apLogger.debug(
      {
        url: attachment.url,
        cid: blobRef.ref.toString(),
        mimeType: blobRef.mimeType,
        size: blobRef.size,
      },
      'successfully downloaded and stored blob',
    )

    return {
      blobRef,
      width: metadata.width,
      height: metadata.height,
      alt: attachment.name || '',
    }
  } catch (err) {
    apLogger.warn(
      { err, url: attachment.url },
      'failed to download and store blob',
    )
    return null
  }
}

export async function downloadAttachments(
  blobTransactor: BlobTransactor,
  attachments: AttachmentInfo[],
): Promise<DownloadedBlob[]> {
  const results: DownloadedBlob[] = []

  for (const attachment of attachments) {
    const result = await downloadAndStoreBlob(blobTransactor, attachment)
    if (result) {
      results.push(result)
    }
  }

  return results
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/')
}
