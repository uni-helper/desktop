import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDesktopConfig } from '../config/resolve'
import type { ResolvedConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { log } from '../log'
import { detectPackageManager, spawnAwait } from './pm'

export interface PackOptions {
  /** Project root, defaults to process.cwd() */
  cwd?: string
}

export interface PackResult {
  output: string
}

/**
 * Build the electron-builder config from the desktop SDK config. The updater
 * feed doubles as the `publish` config when none is given.
 */
export function createElectronBuilderConfig(resolved: ResolvedConfig, root: string): Record<string, unknown> {
  const publish = resolved.pack.publish
    ?? (resolved.updater
      ? {
          provider: resolved.updater.provider ?? 'generic',
          ...(resolved.updater.url ? { url: resolved.updater.url } : {}),
        }
      : undefined)

  const icon = resolved.icon ? 'resources/icon.png' : undefined

  return {
    appId: resolved.appId,
    productName: resolved.appName,
    version: resolved.version,
    ...(resolved.copyright ? { copyright: resolved.copyright } : {}),
    directories: {
      output: join(root, resolved.pack.output),
      buildResources: 'resources',
    },
    files: ['electron/**/*', 'web/**/*', 'resources/**/*', 'package.json'],
    asar: resolved.pack.asar,
    win: {
      target: resolved.pack.targets.win ?? ['nsis'],
      ...(icon ? { icon } : {}),
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      ...resolved.pack.nsis,
    },
    mac: {
      target: resolved.pack.targets.mac ?? ['dmg'],
      ...(icon ? { icon } : {}),
    },
    ...(resolved.pack.dmg ? { dmg: resolved.pack.dmg } : {}),
    linux: {
      target: resolved.pack.targets.linux ?? ['AppImage', 'deb'],
      category: 'Utility',
      ...(icon ? { icon } : {}),
      ...resolved.pack.linux,
    },
    ...(publish ? { publish } : {}),
  }
}

function resolveElectronBuilderCli(root: string): string {
  const require = createRequire(join(root, 'package.json'))
  let pkgPath: string
  try {
    pkgPath = require.resolve('electron-builder/package.json')
  }
  catch {
    throw new DesktopError('electron-builder is not installed. Run `pnpm add -D electron-builder` in your project first.')
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: string | Record<string, string> }
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['electron-builder']
  if (!bin)
    throw new DesktopError('cannot locate the electron-builder CLI entry')
  return join(dirname(pkgPath), bin)
}

export async function packInternal(root: string, resolved: ResolvedConfig, appDir: string): Promise<PackResult> {
  const config = createElectronBuilderConfig(resolved, root)
  const configPath = join(appDir, 'electron-builder.json')
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const cli = resolveElectronBuilderCli(root)
  const pm = detectPackageManager(root)
  log(`running electron-builder via ${pm}...`)
  await spawnAwait(process.execPath, [cli, '--config', configPath], { cwd: appDir })
  return { output: join(root, resolved.pack.output) }
}

/** Package an already-built `dist/desktop` directory with electron-builder. */
export async function pack(options: PackOptions = {}): Promise<PackResult> {
  const { resolved } = await resolveDesktopConfig(options.cwd)
  const root = resolved.root
  const appDir = join(root, 'dist/desktop')
  if (!existsSync(join(appDir, 'package.json')))
    throw new DesktopError(`no desktop app found at ${appDir}, run \`uni-desktop build\` first`)
  return packInternal(root, resolved, appDir)
}
