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

/** Single source of truth for the media types the shim can round-trip. */
const MIME_BY_EXTENSION: Record<string, string> = {
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
  // Common document types: uni.saveFile → openDocument must round-trip the
  // files desktop users actually open, not just images and video. `.htm`
  // precedes `.html` so the reverse map resolves `text/html` to `.html`.
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

/** Reverse lookup derived from the same table, so the two can never drift. */
export const EXTENSION_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_BY_EXTENSION).map(([extension, mime]) => [mime, extension]),
)

export function mimeFromExtension(filePath: string): string {
  return MIME_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
