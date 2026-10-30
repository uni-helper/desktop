import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { DesktopError } from '../error'
import { logger } from '../log'

export interface DevAppBundleOptions {
  /** Absolute path to the electron binary, as returned by `resolveElectronBinary` */
  electronBinary: string
  appName: string
  appId: string
  /** Absolute path to the app icon (png or icns) */
  icon: string
  /** Project root: the patched bundle is cached under `.uni-desktop/dev-electron` */
  root: string
  /** Ad-hoc re-sign the patched bundle; tests patch throwaway clones and skip it */
  sign?: boolean
}

/** Directory (relative to the project root) caching the patched dev Electron bundle. */
const DEV_BUNDLE_CACHE = join('.uni-desktop', 'dev-electron')

const PLIST_BUDDY = '/usr/libexec/PlistBuddy'
const SIPS = '/usr/bin/sips'
const ICONUTIL = '/usr/bin/iconutil'
const CODESIGN = '/usr/bin/codesign'

interface ExecResult {
  code: number
  stdout: string
}

/** Run a macOS dev tool without throwing: the exit code is the verdict. */
function exec(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    execFile(cmd, args, { timeout: 60_000 }, (error, stdout, _stderr) => {
      // `code` is the exit number, or a string errno (e.g. ENOENT) when the
      // tool itself is missing; NaN in either case means "failed".
      const code = error ? Number((error as NodeJS.ErrnoException).code) || 1 : 0
      resolvePromise({ code, stdout: stdout.toString() })
    })
  })
}

/**
 * Walk up from an executable path to the enclosing `.app` bundle directory,
 * or undefined when the binary does not live in one.
 */
export function findAppBundle(binary: string): string | undefined {
  let dir = dirname(binary)
  for (;;) {
    if (basename(dir).endsWith('.app'))
      return dir
    const parent = dirname(dir)
    if (parent === dir)
      return undefined
    dir = parent
  }
}

/**
 * Reduce an app name to a bundle directory name: path separators would break
 * the `.app` path, and a name made of nothing usable needs a fallback.
 */
export function sanitizeBundleName(name: string): string {
  const cleaned = name
    .replace(/[\\/:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
  return cleaned || 'app'
}

/** Set an Info.plist value with PlistBuddy, adding the key when it is missing. */
async function plistSet(plist: string, key: string, value: string): Promise<boolean> {
  const set = await exec(PLIST_BUDDY, ['-c', `Set :${key} ${value}`, plist])
  if (set.code === 0)
    return true
  return (await exec(PLIST_BUDDY, ['-c', `Add :${key} string ${value}`, plist])).code === 0
}

/** Sizes (and their @2x doubles) an `.iconset` folder may contain. */
const ICONSET_SIZES = [16, 32, 128, 256, 512]

/**
 * Convert the app icon into the `.icns` file the bundle's `CFBundleIconFile`
 * points at. An `.icns` source is copied as-is; anything else goes through an
 * `.iconset` folder of sips-rendered sizes so the Dock stays crisp at every
 * size. Returns false on failure, leaving the bundle's original icon in place.
 */
export async function writeIcnsFromIcon(icon: string, icnsPath: string, workDir: string): Promise<boolean> {
  try {
    if (icon.toLowerCase().endsWith('.icns')) {
      await copyFile(icon, icnsPath)
      return true
    }
    const iconset = join(workDir, 'app.iconset')
    await mkdir(iconset, { recursive: true })
    try {
      for (const size of ICONSET_SIZES) {
        for (const [suffix, pixels] of [['', size], ['@2x', size * 2]] as const) {
          const rendered = await exec(SIPS, ['-s', 'format', 'png', '-z', String(pixels), String(pixels), icon, '--out', join(iconset, `icon_${size}x${size}${suffix}.png`)])
          if (rendered.code !== 0)
            return false
        }
      }
      return (await exec(ICONUTIL, ['-c', 'icns', iconset, '-o', icnsPath])).code === 0
    }
    finally {
      await rm(iconset, { recursive: true, force: true })
    }
  }
  catch {
    return false
  }
}

export interface PatchAppBundleOptions {
  appName: string
  appId: string
  icon: string
  sign?: boolean
}

/**
 * Turn a cloned Electron bundle into the app's own bundle: rewrite the name,
 * bundle id and icon the Dock reads from `Info.plist`, then re-sign ad-hoc.
 * The code seal covers `Info.plist` and `Resources`, so any edit invalidates
 * the signature, and an invalid one gets the binary killed on Apple Silicon.
 * Returns false when the bundle could not be made launchable.
 */
export async function patchAppBundle(app: string, options: PatchAppBundleOptions): Promise<boolean> {
  const plist = join(app, 'Contents', 'Info.plist')
  if (!existsSync(plist))
    return false

  // PlistBuddy rewrites the whole file per command, so the edits must run one
  // after another: concurrent instances read each other's half-written plist.
  const renamed = [
    await plistSet(plist, 'CFBundleName', options.appName),
    await plistSet(plist, 'CFBundleDisplayName', options.appName),
    await plistSet(plist, 'CFBundleIdentifier', options.appId),
  ]
  if (renamed.includes(false))
    return false

  const icns = join(app, 'Contents', 'Resources', 'electron.icns')
  if (!await writeIcnsFromIcon(options.icon, icns, dirname(app)))
    logger.warn('could not convert the app icon to .icns, the Dock keeps the runtime icon')

  if (options.sign !== false && (await exec(CODESIGN, ['--force', '--sign', '-', app])).code !== 0)
    return false
  return true
}

/**
 * What the cached bundle was built from. Any change rebuilds it: the electron
 * version because the bundle is a clone of that exact binary, the rest because
 * they are written into `Info.plist` and the `.icns`.
 */
interface BundleIdentity {
  electron: string
  appName: string
  appId: string
  icon: string
}

async function readIdentity(markerPath: string): Promise<BundleIdentity | undefined> {
  try {
    return JSON.parse(await readFile(markerPath, 'utf8')) as BundleIdentity
  }
  catch {
    return undefined
  }
}

/** Electron version stamped in the source bundle's own `Info.plist`. */
async function bundleVersion(bundle: string): Promise<string> {
  const plist = join(bundle, 'Contents', 'Info.plist')
  const printed = await exec(PLIST_BUDDY, ['-c', 'Print :CFBundleVersion', plist])
  return printed.code === 0 ? printed.stdout.trim() : ''
}

/**
 * Prepare the Electron binary to spawn in dev. On macOS the Dock reads the app
 * name and icon from the running bundle, and the stock `Electron.app` ships
 * its own "Electron" values, so its bundle is cloned into
 * `.uni-desktop/dev-electron`, patched with the app's identity and launched
 * from there. That also removes the default-icon flash before the runtime
 * `app.dock.setIcon` call. The clone is cached and rebuilt when the electron
 * version, app name, id or icon changes. Everything falls back to the stock
 * binary on failure, leaving the runtime icon as the only dev workaround.
 */
export async function prepareDevAppBundle(options: DevAppBundleOptions): Promise<string> {
  if (process.platform !== 'darwin')
    return options.electronBinary
  try {
    const source = findAppBundle(options.electronBinary)
    if (!source)
      return options.electronBinary

    const cacheDir = join(options.root, DEV_BUNDLE_CACHE)
    const app = join(cacheDir, `${sanitizeBundleName(options.appName)}.app`)
    const identity: BundleIdentity = {
      electron: await bundleVersion(source),
      appName: options.appName,
      appId: options.appId,
      icon: createHash('sha256').update(await readFile(options.icon)).digest('hex').slice(0, 16),
    }

    const marker = join(cacheDir, 'identity.json')
    const cached = await readIdentity(marker)
    if (cached
      && cached.electron === identity.electron
      && cached.appName === identity.appName
      && cached.appId === identity.appId
      && cached.icon === identity.icon
      && existsSync(join(app, 'Contents', 'MacOS', 'Electron'))) {
      return join(app, 'Contents', 'MacOS', 'Electron')
    }

    await rm(cacheDir, { recursive: true, force: true })
    await mkdir(cacheDir, { recursive: true })

    // APFS clone first: a copy-on-write clone of the whole bundle is instant,
    // while a plain copy would pull ~250 MB through userspace.
    const cloned = await exec('/bin/cp', ['-cR', source, app])
    if (cloned.code !== 0 && (await exec('/bin/cp', ['-R', source, app])).code !== 0)
      throw new DesktopError(`failed to copy the electron bundle to ${app}`)

    if (!await patchAppBundle(app, options))
      throw new DesktopError('failed to patch the copied electron bundle')

    await writeFile(marker, `${JSON.stringify(identity, null, 2)}\n`)
    return join(app, 'Contents', 'MacOS', 'Electron')
  }
  catch (error) {
    logger.warn('could not prepare a named electron bundle, the Dock stays on the runtime icon:', error instanceof Error ? error.message : error)
    return options.electronBinary
  }
}
