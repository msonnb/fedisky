import { BlobRef } from '@atproto/lexicon'
import { apLogger } from '../../logger'
import type { BlobUploader } from '../registry'

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

export async function downloadAndStoreBlob(
  uploadBlob: BlobUploader,
  attachment: AttachmentInfo,
): Promise<DownloadedBlob | null> {
  try {
    apLogger.debug({ url: attachment.url }, 'downloading remote blob')

    const response = await fetch(attachment.url, {
      headers: {
        Accept: attachment.mediaType || 'image/*,video/*,*/*',
        'User-Agent': 'ATProto-ActivityPub/1.0 (Federation Sidecar)',
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

    const arrayBuffer = await response.arrayBuffer()
    const data = new Uint8Array(arrayBuffer)

    const blobRef = await uploadBlob(data, contentType)

    apLogger.debug(
      {
        url: attachment.url,
        ref: blobRef.ref,
        mimeType: blobRef.mimeType,
        size: blobRef.size,
      },
      'successfully downloaded and uploaded blob',
    )

    return {
      blobRef,
      width: null, // Would need image processing to get dimensions
      height: null,
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
  uploadBlob: BlobUploader,
  attachments: AttachmentInfo[],
): Promise<DownloadedBlob[]> {
  const results: DownloadedBlob[] = []

  for (const attachment of attachments) {
    const result = await downloadAndStoreBlob(uploadBlob, attachment)
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
