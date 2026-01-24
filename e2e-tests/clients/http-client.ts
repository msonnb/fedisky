/**
 * Custom HTTP client that supports setting the Host header.
 *
 * Node.js native fetch() ignores the Host header because it's a "forbidden header"
 * per the Fetch specification. This module uses the node:http module directly
 * to properly support virtual host-based routing through reverse proxies like Traefik.
 */
import * as http from 'node:http'
import * as https from 'node:https'

export interface HttpRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  maxRedirects?: number
}

export interface HttpResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Map<string, string>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
}

/**
 * Make an HTTP request with full control over headers including Host.
 * Automatically follows redirects (301, 302, 307, 308) up to maxRedirects times.
 */
export function httpRequest(
  url: string,
  virtualHost: string,
  options: HttpRequestOptions = {},
  redirectCount: number = 0,
): Promise<HttpResponse> {
  const maxRedirects = options.maxRedirects ?? 5

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const transport = isHttps ? https : http

    const headers: Record<string, string> = {
      Host: virtualHost,
      ...options.headers,
    }

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    const req = transport.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        // Handle redirects
        const statusCode = res.statusCode ?? 0
        if (
          [301, 302, 307, 308].includes(statusCode) &&
          res.headers.location &&
          redirectCount < maxRedirects
        ) {
          // For 307/308, preserve the method and body
          // For 301/302, typically convert to GET (but we'll preserve for simplicity)
          // Parse the location to get just the path, keeping the original host/port
          const locationUrl = new URL(res.headers.location, url)
          // Build redirect URL using original host but new path
          const redirectUrl = new URL(url)
          redirectUrl.pathname = locationUrl.pathname
          redirectUrl.search = locationUrl.search
          resolve(
            httpRequest(
              redirectUrl.href,
              virtualHost,
              options,
              redirectCount + 1,
            ),
          )
          return
        }

        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          const responseHeaders = new Map<string, string>()
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              responseHeaders.set(key.toLowerCase(), value)
            } else if (Array.isArray(value)) {
              responseHeaders.set(key.toLowerCase(), value.join(', '))
            }
          }

          const response: HttpResponse = {
            ok: statusCode >= 200 && statusCode < 300,
            status: statusCode,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
            text: () => Promise.resolve(data),
            json: <T>() => Promise.resolve(JSON.parse(data) as T),
          }
          resolve(response)
        })
      },
    )

    req.on('error', reject)

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}
