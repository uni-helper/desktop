import { extname } from 'node:path'

export const DESKTOP_FILE_SCHEME = 'desktop-file'

/** Wrap an absolute path into a `desktop-file://` URL servable by the app. */
export function toDesktopFileUrl(absolutePath: string): string {
  return `${DESKTOP_FILE_SCHEME}://f/${encodeURIComponent(absolutePath)}`
}

/** Parse a `desktop-file://` URL back to an absolute path. */
export function parseDesktopFileUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== `${DESKTOP_FILE_SCHEME}:`)
    throw new Error(`unsupported protocol in ${url}`)
  const encoded = parsed.pathname.replace(/^\//, '')
  if (!encoded)
    throw new Error(`missing path in ${url}`)
  return decodeURIComponent(encoded)
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.zip': 'application/zip',
}

export function mimeFromExtension(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
