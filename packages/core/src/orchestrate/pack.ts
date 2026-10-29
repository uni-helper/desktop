import type { ResolvedConfig } from '../config/resolve'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { resolveDesktopConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { logger } from '../log'
import { APP_DIR, APP_RESOURCES_DIR, appIconFileName } from '../shared/paths'
import { detectPackageManager, spawnAwait } from './pm'

export interface PackOptions {
  /** Project root, defaults to process.cwd() */
  cwd?: string
  /** Extra arguments appended to the electron-builder CLI, e.g. `['--publish', 'always']` */
  args?: string[]
}

export interface PackResult {
  output: string
}

/** Read the installed electron version; electron-builder needs an exact one. */
function resolveElectronVersion(root: string): string {
  const require = createRequire(join(root, 'package.json'))
  try {
    const pkgPath = require.resolve('electron/package.json')
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version
  }
  catch {
    throw new DesktopError(
      'electron is not installed in this project, so its version cannot be pinned for electron-builder. '
      + 'Run `pnpm add -D electron` first.',
    )
  }
}

/**
 * Build the electron-builder config from the desktop SDK config. The updater
 * feed doubles as the `publish` config when none is given.
 *
 * `electronVersion` is injected explicitly: electron-builder derives the
 * `projectDir` from the working directory (the assembled app dir), where no
 * `node_modules/electron` exists, so it would otherwise fail with
 * "Cannot compute electron version".
 */
export function createElectronBuilderConfig(
  resolved: ResolvedConfig,
  root: string,
  electronVersion: string,
): Record<string, unknown> {
  const publish = resolved.pack.publish
    ?? (resolved.updater
      ? {
          provider: resolved.updater.provider ?? 'generic',
          ...(resolved.updater.url ? { url: resolved.updater.url } : {}),
        }
      : undefined)

  // The resolved icon is always absolute (built-in uni-helper icon by default),
  // so the installer icon is never Electron's own.
  const icon = `${APP_RESOURCES_DIR}/${appIconFileName(resolved.icon)}`

  return {
    appId: resolved.appId,
    productName: resolved.appName,
    electronVersion,
    // `version` is not a valid electron-builder config key; it is read from the
    // app `package.json`, which `build` writes from the resolved config.
    ...(resolved.copyright ? { copyright: resolved.copyright } : {}),
    directories: {
      output: join(root, resolved.pack.output),
      buildResources: APP_RESOURCES_DIR,
    },
    files: ['electron/**/*', 'web/**/*', 'resources/**/*', 'package.json'],
    asar: resolved.pack.asar,
    win: {
      target: resolved.pack.targets.win ?? ['nsis'],
      icon,
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      ...resolved.pack.nsis,
    },
    mac: {
      target: resolved.pack.targets.mac ?? ['dmg'],
      icon,
    },
    ...(resolved.pack.dmg ? { dmg: resolved.pack.dmg } : {}),
    linux: {
      // `deb` additionally requires author email and homepage, so AppImage is
      // the only target that works out of the box.
      target: resolved.pack.targets.linux ?? ['AppImage'],
      category: 'Utility',
      icon,
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

export async function packInternal(
  root: string,
  resolved: ResolvedConfig,
  appDir: string,
  extraArgs: string[] = [],
): Promise<PackResult> {
  const electronVersion = resolveElectronVersion(root)
  const config = createElectronBuilderConfig(resolved, root, electronVersion)
  const configPath = join(appDir, 'electron-builder.json')
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const cli = resolveElectronBuilderCli(root)
  const pm = detectPackageManager(root)
  logger.start(`running electron-builder via ${pm} (electron ${electronVersion})...`)
  await spawnAwait(process.execPath, [cli, '--config', configPath, ...extraArgs], { cwd: appDir })
  return { output: join(root, resolved.pack.output) }
}

/** Package an already-built `dist/desktop` directory with electron-builder. */
export async function pack(options: PackOptions = {}): Promise<PackResult> {
  const { resolved } = await resolveDesktopConfig(options.cwd)
  const root = resolved.root
  const appDir = join(root, APP_DIR)
  if (!existsSync(join(appDir, 'package.json')))
    throw new DesktopError(`no desktop app found at ${appDir}, run \`uni-desktop build\` first`)
  return packInternal(root, resolved, appDir, options.args)
}
