import type { DesktopTrayConfig, DesktopUpdaterConfig, DesktopWindowConfig } from './types'

/**
 * Serializable config baked into the bundled main process through the
 * `__DESKTOP_CONFIG__` esbuild define. Keep it JSON-safe.
 */
export interface BakedDesktopConfig {
  appName: string
  appId: string
  version: string
  window: {
    title: string
    width: number
    height: number
    minWidth?: number
    minHeight?: number
    center: boolean
    resizable: boolean
    fullscreen: boolean
    frame: boolean
    titleBarStyle?: 'default' | 'hidden' | 'hiddenInset'
    autoHideMenuBar: boolean
    backgroundColor?: string
    show: boolean
    alwaysOnTop: boolean
    kiosk: boolean
  }
  dev: {
    openDevtools: boolean
  }
  tray: {
    iconPath?: string
    tooltip?: string
    menu?: DesktopTrayConfig['menu']
  } | false
  updater: DesktopUpdaterConfig | false
  /** Absolute path to the window icon, when one exists */
  iconPath?: string
}
