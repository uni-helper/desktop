import type { BakedDesktopConfig } from '../baked'
import type { ManifestInfo } from '../shared/manifest'
import type { DesktopConfig, DesktopTrayMenuItem, DesktopUpdaterConfig, DesktopWindowConfig, ResolvedWindowConfig, UnhConfig } from '../types'

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { loadConfig } from 'unconfig'
import { DesktopError } from '../error'
import { parseManifest } from '../shared/manifest'
import { defaultIconPath } from '../shared/paths'

export type { ManifestInfo } from '../shared/manifest'

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
  /**
   * Absolute path to the icon used for the window, the tray fallback and the
   * installers. Defaults to the built-in uni-helper icon when `app.icon` is not
   * configured, so every app gets a real icon instead of Electron's.
   */
  icon: string
  window: ResolvedWindowConfig
  dev: {
    url: string
    openDevtools: boolean
  }
  tray: {
    /** Absolute tray icon path; defaults to the app icon */
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
  return {
    ...DEFAULT_WINDOW,
    // Explicit `undefined` overrides must not clobber the defaults.
    ...Object.fromEntries(Object.entries(config ?? {}).filter(([, entry]) => entry !== undefined)),
    title: config?.title ?? fallbackTitle,
  }
}

async function readManifest(root: string): Promise<ManifestInfo | undefined> {
  const file = join(root, 'src/manifest.json')
  if (!existsSync(file))
    return undefined
  return parseManifest(await readFile(file, 'utf8')).manifest
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

  const icon = resolveAppIcon(root, config.app?.icon)
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
      openDevtools: config.dev?.openDevtools ?? false,
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
 * Resolve the app icon to an absolute path. A configured `app.icon` must exist
 * so a typo fails loudly instead of silently falling back; without one the
 * built-in uni-helper icon is used, so the window, tray and installers never
 * fall back to Electron's own icon.
 */
function resolveAppIcon(root: string, icon: string | undefined): string {
  if (!icon)
    return defaultIconPath()
  const candidate = join(root, icon)
  if (!existsSync(candidate))
    throw new DesktopError(`app icon not found at ${icon}`)
  return candidate
}

/**
 * Tray icons default to the app icon. An explicit tray icon must exist, so a
 * typo fails loudly instead of silently disabling the tray after packaging.
 */
function resolveTrayIcon(root: string, trayIcon: string | undefined, appIcon: string): string {
  if (!trayIcon)
    return appIcon
  const candidate = join(root, trayIcon)
  if (!existsSync(candidate))
    throw new DesktopError(`tray icon not found at ${trayIcon}`)
  return candidate
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
