import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory (relative to the project root) holding the assembled app. */
export const APP_DIR = 'dist/desktop'

/** Directory (relative to the app dir) holding assets referenced by the baked config. */
export const APP_RESOURCES_DIR = 'resources'

/** File name of the built-in uni-helper icon inside the package `assets` directory. */
const DEFAULT_ICON_FILE = 'icon.png'

/** File name of the window icon inside the app resources directory. */
export function appIconFileName(iconPath: string): string {
  return `icon${extensionOf(iconPath)}`
}

/** File name of the tray icon inside the app resources directory. */
export function trayIconFileName(iconPath: string): string {
  return `tray-icon${extensionOf(iconPath)}`
}

/**
 * Absolute path to the built-in uni-helper icon shipped with the package.
 *
 * Like `getTemplateDir`, the module is loaded from `src/shared` in tests and
 * from the bundled `dist/index.mjs` once published, so both layouts are probed.
 */
export function defaultIconPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [join(here, 'assets', DEFAULT_ICON_FILE), join(here, '..', 'assets', DEFAULT_ICON_FILE)]) {
    if (existsSync(candidate))
      return candidate
  }
  throw new Error(`cannot locate the built-in app icon near ${here}`)
}

function extensionOf(filePath: string): string {
  const index = filePath.lastIndexOf('.')
  return index === -1 ? '.png' : filePath.slice(index)
}
