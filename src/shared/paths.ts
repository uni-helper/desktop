import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory (relative to the project root) receiving the assembled app from a build. */
export const BUILD_APP_DIR = 'dist/build/desktop'

/** Directory (relative to the project root) holding the dev shell runtime. */
export const DEV_APP_DIR = 'dist/dev/desktop'

/** Directory (relative to the app dir) holding assets referenced by the baked config. */
export const APP_RESOURCES_DIR = 'resources'

/**
 * The assembled app layout contract, shared by the build side (driver, pack,
 * bundle) and the runtime side (createDesktopApp). Renaming any of these means
 * editing every consumer in the same commit: `test/driver.test.ts` and
 * `test/bundle.test.ts` pin the literals and will catch a miss.
 *
 * appDir/
 *   package.json        ← written by `assembleDesktopApp` (main: electron/main.cjs)
 *   electron/main.cjs   ← esbuild bundle of the main-process entry
 *   electron/preload.cjs ← esbuild bundle of the preload template
 *   web/                ← the uni h5 build output, moved in wholesale
 *   resources/          ← icons referenced by the baked config
 */
/** Directory (relative to the app dir) holding the bundled main/preload scripts. */
export const APP_ELECTRON_DIR = 'electron'
/** Directory (relative to the app dir) holding the uni web build. */
export const APP_WEB_DIR = 'web'
/** File name of the bundled main-process script inside `APP_ELECTRON_DIR`. */
export const MAIN_BUNDLE_FILE = 'main.cjs'
/** File name of the bundled preload script inside `APP_ELECTRON_DIR`. */
export const PRELOAD_BUNDLE_FILE = 'preload.cjs'

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
