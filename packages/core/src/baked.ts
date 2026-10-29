import type { DesktopTrayMenuItem, DesktopUpdaterConfig, ResolvedWindowConfig } from './types'

/**
 * Serializable config baked into the bundled main process through the
 * `__DESKTOP_CONFIG__` esbuild define. Keep it JSON-safe.
 *
 * Asset references are file names inside the app resources directory, never
 * absolute paths: electron-builder moves the assembled app directory, so a
 * build-time absolute path would not exist on the user's machine.
 */
export interface BakedDesktopConfig {
  appName: string
  appId: string
  version: string
  window: ResolvedWindowConfig
  dev: {
    openDevtools: boolean
  }
  tray: {
    /** File name of the tray icon inside the app resources directory */
    icon?: string
    tooltip?: string
    menu?: DesktopTrayMenuItem[]
  } | false
  updater: DesktopUpdaterConfig | false
  /** File name of the window icon inside the app resources directory */
  icon?: string
}
