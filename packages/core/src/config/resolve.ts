import type { BakedDesktopConfig } from '../baked'
import type { DesktopConfig, DesktopTrayMenuItem, DesktopUpdaterConfig, DesktopWindowConfig, ResolvedWindowConfig, UnhConfig } from '../types'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { loadConfig } from 'unconfig'
import { DesktopError } from '../error'

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

/** Metadata read from the project `package.json`, used to fill installer fields. */
export interface ProjectInfo {
  author?: string
  homepage?: string
  description?: string
}

export interface ResolvedConfig {
  root: string
  appName: string
  appId: string
  version: string
  copyright?: string
  /** Author shown by Linux package managers */
  author?: string
  /** Project homepage shown by Linux package managers */
  homepage?: string
  /** Short description used by installers */
  description?: string
  /** Project-relative icon path, when the file exists */
  icon?: string
  window: ResolvedWindowConfig
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
    /** Project-relative tray icon path; falls back to `icon` */
    icon?: string
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

const DEFAULT_WINDOW: ResolvedWindowConfig = {
  title: '',
  width: 420,
  height: 760,
  center: true,
  resizable: true,
  fullscreen: false,
  frame: true,
  autoHideMenuBar: true,
  show: true,
  alwaysOnTop: false,
  kiosk: false,
}

/** Resolve a window config against the defaults, dropping undefined overrides. */
function resolveWindow(config: DesktopWindowConfig | undefined, fallbackTitle: string): ResolvedWindowConfig {
  const merged: ResolvedWindowConfig = {
    ...DEFAULT_WINDOW,
    ...stripUndefined(config),
    title: config?.title ?? fallbackTitle,
  }
  return merged
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value)
    return {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

async function readManifest(root: string): Promise<ManifestInfo | undefined> {
  const file = join(root, 'src/manifest.json')
  if (!existsSync(file))
    return undefined
  return JSON.parse(await readFile(file, 'utf8')) as ManifestInfo
}

async function readProjectInfo(root: string): Promise<ProjectInfo> {
  const file = join(root, 'package.json')
  if (!existsSync(file))
    return {}
  const pkg = JSON.parse(await readFile(file, 'utf8')) as {
    author?: string | { name?: string, email?: string }
    homepage?: string
    description?: string
  }
  const author = typeof pkg.author === 'string'
    ? pkg.author
    : pkg.author
      ? [pkg.author.name, pkg.author.email && `<${pkg.author.email}>`].filter(Boolean).join(' ')
      : undefined
  return { author, homepage: pkg.homepage, description: pkg.description }
}

function sanitizeBundleIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
}

function buildAppId(appName: string): string {
  return `desktop.uniapp.${sanitizeBundleIdPart(appName)}`
}

export function normalizeConfig(
  config: DesktopConfig,
  manifest: ManifestInfo | undefined,
  root: string,
  project: ProjectInfo = {},
): ResolvedConfig {
  const appName = config.app?.name ?? manifest?.name ?? 'uni-app-desktop'
  const window = resolveWindow(config.window, config.window?.title ?? manifest?.h5?.title ?? appName)

  const icon = config.app?.icon && existsSync(join(root, config.app.icon)) ? config.app.icon : undefined
  const tray = config.tray
    ? {
        ...config.tray,
        icon: resolveTrayIcon(root, config.tray.icon, icon),
      }
    : false

  return {
    root,
    appName,
    appId: config.app?.appId ?? buildAppId(appName),
    version: config.app?.version ?? manifest?.versionName ?? '1.0.0',
    copyright: config.app?.copyright,
    author: config.app?.author ?? project.author,
    homepage: config.app?.homepage ?? project.homepage,
    description: config.app?.description ?? project.description ?? manifest?.description,
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

/**
 * Tray icons default to the app icon. An explicit tray icon must exist, so a
 * typo fails loudly instead of silently disabling the tray after packaging.
 */
function resolveTrayIcon(root: string, trayIcon: string | undefined, appIcon: string | undefined): string | undefined {
  if (!trayIcon)
    return appIcon
  if (!existsSync(join(root, trayIcon)))
    throw new DesktopError(`tray icon not found at ${trayIcon}`)
  return trayIcon
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
  const project = await readProjectInfo(root)
  const userConfig = await loadUserConfig(root)
  const warnings = collectWarnings(manifest)
  const resolved = normalizeConfig(userConfig ?? {}, manifest, root, project)
  return { resolved, manifest, userConfig, warnings }
}

/**
 * Serialize the config for the bundled main process. Asset paths are reduced to
 * file names inside the app resources directory; the runtime resolves them
 * against the assembled app layout.
 */
export function bakeConfig(resolved: ResolvedConfig, assets: { icon?: string, trayIcon?: string } = {}): BakedDesktopConfig {
  const tray = resolved.tray
    ? {
        icon: assets.trayIcon,
        tooltip: resolved.tray.tooltip,
        menu: resolved.tray.menu,
      }
    : false

  return {
    appName: resolved.appName,
    appId: resolved.appId,
    version: resolved.version,
    window: resolved.window,
    dev: {
      openDevtools: resolved.dev.openDevtools,
    },
    tray,
    updater: resolved.updater,
    icon: assets.icon,
  }
}
