export interface DesktopAppConfig {
  /** App name, defaults to the `name` in manifest.json */
  name?: string
  /** Bundle identifier used by electron-builder, e.g. `com.example.app` */
  appId?: string
  /** App version, defaults to the `versionName` in manifest.json */
  version?: string
  /** Copyright line rendered into installers */
  copyright?: string
  /** Project-relative path to a PNG icon, at least 512x512 */
  icon?: string
}

export interface DesktopWindowConfig {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  center?: boolean
  resizable?: boolean
  fullscreen?: boolean
  frame?: boolean
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset'
  autoHideMenuBar?: boolean
  backgroundColor?: string
  show?: boolean
  alwaysOnTop?: boolean
  kiosk?: boolean
}

export interface DesktopDevConfig {
  /** URL of the H5 dev server the Electron window loads, defaults to `http://localhost:5173` */
  url?: string
  /** npm script that starts the H5 dev server, defaults to `dev:h5` */
  command?: string
  /** Milliseconds to wait for the dev server before failing, defaults to 60000 */
  waitTimeout?: number
  /** Milliseconds between reachability probes, defaults to 500 */
  interval?: number
  /** Open detached DevTools in the desktop window */
  openDevtools?: boolean
}

export interface DesktopBuildConfig {
  /** npm script that builds the H5 bundle, defaults to `build:h5` */
  command?: string
}

export interface DesktopTrayMenuItem {
  label?: string
  role?: string
  enabled?: boolean
  visible?: boolean
}

export interface DesktopTrayConfig {
  /** Project-relative path to the tray icon */
  icon: string
  tooltip?: string
  menu?: DesktopTrayMenuItem[]
}

export interface DesktopUpdaterConfig {
  /** electron-updater provider, defaults to `generic` */
  provider?: 'generic' | 'github' | 'gitlab' | 's3' | 'spaces'
  /** Feed URL, required for the `generic` provider */
  url?: string
  autoDownload?: boolean
  autoInstallOnAppQuit?: boolean
}

export interface DesktopPackConfig {
  /** Run electron-builder automatically after `build`, defaults to true */
  autoPack?: boolean
  /** electron-builder output directory, defaults to `dist/release` */
  output?: string
  /** Pack the app into an asar archive, defaults to true */
  asar?: boolean
  /** Per-platform installer targets, e.g. `{ win: ['nsis'], mac: ['dmg'], linux: ['AppImage', 'deb'] }` */
  targets?: {
    win?: string[]
    mac?: string[]
    linux?: string[]
  }
  /** Extra electron-builder `nsis` options */
  nsis?: Record<string, unknown>
  /** Extra electron-builder `dmg` options */
  dmg?: Record<string, unknown>
  /** Extra electron-builder `linux` options */
  linux?: Record<string, unknown>
  /** electron-builder `publish` config, required for auto update */
  publish?: Record<string, unknown> | Array<Record<string, unknown>>
}

export interface DesktopMainConfig {
  /** Custom main process entry, relative to the project root */
  entry?: string
}

export interface DesktopConfig {
  app?: DesktopAppConfig
  window?: DesktopWindowConfig
  dev?: DesktopDevConfig
  build?: DesktopBuildConfig
  tray?: DesktopTrayConfig | false
  updater?: DesktopUpdaterConfig | false
  main?: DesktopMainConfig
  pack?: DesktopPackConfig
}

/**
 * Shape of `unh.config.ts`.
 *
 * Desktop options live under the `desktop` key so other uni-helper tools can
 * share the same config file with their own top-level keys.
 */
export interface UnhConfig {
  desktop?: DesktopConfig
  [key: string]: unknown
}
