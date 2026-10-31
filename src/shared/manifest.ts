import type { JsonuDocument } from '@uni-helper/jsonu'
import { parse } from '@uni-helper/jsonu'

/**
 * Fields the desktop toolchain reads from the project `src/manifest.json`.
 *
 * The file is uni-app json: JSONC comments plus `#ifdef` conditional
 * compilation. It must go through `@uni-helper/jsonu`, never `JSON.parse`.
 */
export interface ManifestInfo {
  name?: string
  appid?: string
  versionName?: string
  description?: string
  h5?: {
    title?: string
    router?: {
      mode?: string
      base?: string
    }
  }
}

/** A parsed manifest plus its H5 evaluation (desktop apps build on uni-h5). */
export interface ParsedManifest {
  /** Document keeping conditional compilation intact, for `set`/`stringify` round-trips */
  doc: JsonuDocument
  /** Manifest evaluated for H5, or undefined when the file holds no JSON object */
  manifest: ManifestInfo | undefined
}

/**
 * Parse a uni-app json file and evaluate it for the H5 platform: `#ifdef H5`
 * data applies, other platforms' data is trimmed, and conditional members later
 * in the file override earlier ones, matching uni-app's compiler.
 *
 * `@uni-helper/jsonu` follows the compiler, which rejects trailing commas even
 * though `manifest.json` files in the wild contain them. Strip those with a
 * fallback scan before re-parsing.
 */
export function parseManifest(text: string): ParsedManifest {
  let doc: JsonuDocument
  try {
    doc = parse(text)
  }
  catch {
    doc = parse(stripTrailingCommas(text))
  }
  const manifest = doc.evaluate('H5')
  return {
    doc,
    manifest: manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? manifest as ManifestInfo
      : undefined,
  }
}

/** Index of the next character that is not whitespace or a comment, or `text.length`. */
function skipInsignificant(text: string, start: number): number {
  let i = start
  while (i < text.length) {
    const ch = text[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
    }
    else if (ch === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i)
      if (i === -1)
        return text.length
    }
    else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1)
        return text.length
      i = end + 2
    }
    else {
      return i
    }
  }
  return i
}

/** Remove commas directly followed by a closing brace or bracket, ignoring strings and comments. */
function stripTrailingCommas(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '"') {
      // Copy string literals verbatim so `, }` inside them is left alone.
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i += text[i] === '\\' ? 2 : 1);
      i++
      out += text.slice(start, i)
      continue
    }
    if (ch === ',') {
      const next = text[skipInsignificant(text, i + 1)]
      if (next === '}' || next === ']') {
        i++ // Drop the comma, keep the brace or bracket after it.
        continue
      }
    }
    out += ch
    i++
  }
  return out
}
