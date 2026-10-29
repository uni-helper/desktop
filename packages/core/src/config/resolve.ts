import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadConfig } from 'unconfig'
import type { BakedDesktopConfig } from '../baked'
import type { DesktopConfig, DesktopTrayMenuItem, DesktopUpdaterConfig, DesktopWindowConfig, UnhConfig } from '../types'

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

export interface ResolvedConfig {
  root: string
  appName: string
  appId: string
  version: string
  copyright?: string
  /** Project-relative icon path, when the file exists */
  icon?: string
  window: DesktopWindowConfig
  dev: {
    url: string
    command: string
    waitTimeout: number
    interval: number
    openDevtools: boolean
  }
  build: {
    command: string
  }
  tray: {
    icon: string
    tooltip?: string
    menu?: DesktopTrayMenuItem[]
  } | false
  updater: DesktopUpdaterConfig | false
  /** Project-relative custom main entry */
  mainEntry?: string
  pack: {
    autoPack: boolean
    output: string
    asar: boolean
    targets: { win?: string[], mac?: string[], linux?: string[] }
    nsis?: Record<string, unknown>
    dmg?: Record<string, unknown>
    linux?: Record<string, unknown>
    publish?: Record<string, unknown> | Array<Record<string, unknown>>
  }
}

async function readManifest(root: string): Promise<ManifestInfo | undefined> {
  const file = join(root, 'src/manifest.json')
  if (!existsSync(file))
    return undefined
  return JSON.parse(await readFile(file, 'utf8')) as ManifestInfo
}

function sanitizeBundleIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
}

function buildAppId(appName: string): string {
  return `desktop.uniapp.${sanitizeBundleIdPart(appName)}`
}

export function normalizeConfig(config: DesktopConfig, manifest: ManifestInfo | undefined, root: string): ResolvedConfig {
  const appName = config.app?.name ?? manifest?.name ?? 'uni-app-desktop'
  const window: DesktopWindowConfig = {
    title: config.window?.title ?? manifest?.h5?.title ?? appName,
    width: config.window?.width ?? 420,
    height: config.window?.height ?? 760,
    minWidth: config.window?.minWidth,
    minHeight: config.window?.minHeight,
    center: config.window?.center ?? true,
    resizable: config.window?.resizable ?? true,
    fullscreen: config.window?.fullscreen ?? false,
    frame: config.window?.frame ?? true,
    titleBarStyle: config.window?.titleBarStyle,
    autoHideMenuBar: config.window?.autoHideMenuBar ?? true,
    backgroundColor: config.window?.backgroundColor,
    show: config.window?.show ?? true,
    alwaysOnTop: config.window?.alwaysOnTop ?? false,
    kiosk: config.window?.kiosk ?? false,
  }

  const icon = config.app?.icon && existsSync(join(root, config.app.icon)) ? config.app.icon : undefined
  const tray = config.tray
    ? {
        ...config.tray,
        icon: existsSync(join(root, config.tray.icon)) ? config.tray.icon : '',
      }
    : false
  if (tray && !tray.icon)
    throw new Error(`tray icon not found at ${config.tray && config.tray.icon}`)

  return {
    root,
    appName,
    appId: config.app?.appId ?? buildAppId(appName),
    version: config.app?.version ?? manifest?.versionName ?? '1.0.0',
    copyright: config.app?.copyright,
    icon,
    window,
    dev: {
      url: config.dev?.url ?? 'http://localhost:5173',
      command: config.dev?.command ?? 'dev:h5',
      waitTimeout: config.dev?.waitTimeout ?? 60_000,
      interval: config.dev?.interval ?? 500,
      openDevtools: config.dev?.openDevtools ?? false,
    },
    build: {
      command: config.build?.command ?? 'build:h5',
    },
    tray,
    updater: config.updater ?? false,
    mainEntry: config.main?.entry,
    pack: {
      autoPack: config.pack?.autoPack ?? true,
      output: config.pack?.output ?? 'dist/release',
      asar: config.pack?.asar ?? true,
      targets: config.pack?.targets ?? {},
      nsis: config.pack?.nsis,
      dmg: config.pack?.dmg,
      linux: config.pack?.linux,
      publish: config.pack?.publish,
    },
  }
}

function collectWarnings(manifest: ManifestInfo | undefined): string[] {
  const warnings: string[] = []
  if (!manifest) {
    warnings.push('src/manifest.json not found, falling back to default values')
    return warnings
  }
  const mode = manifest.h5?.router?.mode
  if (mode && mode !== 'hash')
    warnings.push(`manifest.json h5.router.mode is "${mode}", desktop packaging requires "hash" or pages will be blank when loaded from file://`)
  const base = manifest.h5?.router?.base
  if (base && base !== './')
    warnings.push(`manifest.json h5.router.base is "${base}", set it to "./" so assets resolve from file://`)
  return warnings
}

async function loadUserConfig(root: string): Promise<DesktopConfig | undefined> {
  const { config } = await loadConfig<UnhConfig>({
    sources: [{ files: 'unh.config' }],
    cwd: root,
  })
  return config?.desktop
}

export interface ResolveResult {
  resolved: ResolvedConfig
  manifest: ManifestInfo | undefined
  userConfig: DesktopConfig | undefined
  warnings: string[]
}

export async function resolveDesktopConfig(cwd?: string): Promise<ResolveResult> {
  const root = resolve(cwd ?? process.cwd())
  const manifest = await readManifest(root)
  const userConfig = await loadUserConfig(root)
  const warnings = collectWarnings(manifest)
  const resolved = normalizeConfig(userConfig ?? {}, manifest, root)
  return { resolved, manifest, userConfig, warnings }
}

export function bakeConfig(resolved: ResolvedConfig, iconPath?: string): BakedDesktopConfig {
  const tray = resolved.tray
    ? {
        iconPath: join(resolved.root, resolved.tray.icon),
        tooltip: resolved.tray.tooltip,
        menu: resolved.tray.menu,
      }
    : false

  return {
    appName: resolved.appName,
    appId: resolved.appId,
    version: resolved.version,
    window: {
      title: resolved.window.title ?? resolved.appName,
      width: resolved.window.width ?? 420,
      height: resolved.window.height ?? 760,
      minWidth: resolved.window.minWidth,
      minHeight: resolved.window.minHeight,
      center: resolved.window.center ?? true,
      resizable: resolved.window.resizable ?? true,
      fullscreen: resolved.window.fullscreen ?? false,
      frame: resolved.window.frame ?? true,
      titleBarStyle: resolved.window.titleBarStyle,
      autoHideMenuBar: resolved.window.autoHideMenuBar ?? true,
      backgroundColor: resolved.window.backgroundColor,
      show: resolved.window.show ?? true,
      alwaysOnTop: resolved.window.alwaysOnTop ?? false,
      kiosk: resolved.window.kiosk ?? false,
    },
    dev: {
      openDevtools: resolved.dev.openDevtools,
    },
    tray,
    updater: resolved.updater,
    iconPath: iconPath ?? (resolved.icon ? join(resolved.root, resolved.icon) : undefined),
  }
}
