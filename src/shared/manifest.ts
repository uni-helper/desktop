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
 * Like the compiler, trailing commas are rejected: uni-app requires json to
 * stay syntactically valid with and without the conditional blocks applied.
 */
export function parseManifest(text: string): ParsedManifest {
  const doc = parse(text)
  const manifest = doc.evaluate('H5')
  return {
    doc,
    manifest: manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? manifest as ManifestInfo
      : undefined,
  }
}
