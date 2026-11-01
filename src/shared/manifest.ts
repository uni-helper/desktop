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

/** A parsed manifest plus its DESKTOP evaluation (the platform this tool builds for). */
export interface ParsedManifest {
  /** Document keeping conditional compilation intact, for `set`/`stringify` round-trips */
  doc: JsonuDocument
  /** Manifest evaluated for DESKTOP, or undefined when the file holds no JSON object */
  manifest: ManifestInfo | undefined
}

/**
 * Parse a uni-app json file and evaluate it for the DESKTOP platform, the same
 * view uni's compiler gets when building through uni-desktop: `#ifdef DESKTOP`
 * data applies, `#ifdef H5`/`#ifdef WEB` and other platforms' data is trimmed,
 * and conditional members later in the file override earlier ones, matching
 * uni-app's compiler.
 *
 * Like the compiler, trailing commas are rejected: uni-app requires json to
 * stay syntactically valid with and without the conditional blocks applied.
 */
export function parseManifest(text: string): ParsedManifest {
  const doc = parse(text)
  const manifest = doc.evaluate('DESKTOP')
  return {
    doc,
    manifest: manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? manifest as ManifestInfo
      : undefined,
  }
}
