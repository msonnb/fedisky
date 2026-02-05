import { BlobRef } from '@atproto/lexicon'
import { logger } from '../../logger'
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

export interface DownloadBlobOptions {
  allowPrivateAddress?: boolean
}

function isPrivateIP(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  ) {
    return true
  }
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local)
  }
  return false
}

function validateBlobUrl(url: string, allowPrivate: boolean): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid URL scheme: ${parsed.protocol}`)
  }
  if (!allowPrivate && isPrivateIP(parsed.hostname)) {
    throw new Error(`Private IP addresses not allowed: ${parsed.hostname}`)
  }
}

export async function downloadAndStoreBlob(
  uploadBlob: BlobUploader,
  attachment: AttachmentInfo,
  options?: DownloadBlobOptions,
): Promise<DownloadedBlob | null> {
  try {
    validateBlobUrl(attachment.url, options?.allowPrivateAddress ?? false)

    logger.debug('downloading remote blob', { url: attachment.url })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

    const response = await fetch(attachment.url, {
      headers: {
        Accept: attachment.mediaType || 'image/*,video/*,*/*',
        'User-Agent': 'ATProto-ActivityPub/1.0 (Federation Sidecar)',
      },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      logger.warn('failed to fetch remote blob', {
        url: attachment.url,
        status: response.status,
      })
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
      logger.warn('remote blob too large, skipping', {
        url: attachment.url,
        size: contentLength,
      })
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const data = new Uint8Array(arrayBuffer)

    // Enforce size limit on actual downloaded content (not just Content-Length header)
    if (data.byteLength > maxSize) {
      logger.warn('downloaded blob exceeds size limit, skipping', {
        url: attachment.url,
        size: data.byteLength,
      })
      return null
    }

    const blobRef = await uploadBlob(data, contentType)

    logger.debug('successfully downloaded and uploaded blob', {
      url: attachment.url,
      ref: blobRef.ref,
      mimeType: blobRef.mimeType,
      size: blobRef.size,
    })

    return {
      blobRef,
      width: null, // Would need image processing to get dimensions
      height: null,
      alt: attachment.name || '',
    }
  } catch (err) {
    // Handle AbortError for timeout
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('blob download timed out', { url: attachment.url })
      return null
    }
    logger.warn('failed to download and store blob', {
      err,
      url: attachment.url,
    })
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
