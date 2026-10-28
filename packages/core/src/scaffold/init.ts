import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DesktopError } from '../error'
import { log } from '../log'
import { addCommand, detectPackageManager, spawnAwait } from '../orchestrate/pm'

export interface InitOptions {
  /** Project root, defaults to process.cwd() */
  cwd?: string
  /** Install the required dependencies after scaffolding, defaults to true */
  install?: boolean
}

const RUNTIME_DEPS = ['@uni-helper/desktop-shim']
const DEV_DEPS = ['@uni-helper/desktop', '@uni-helper/desktop-cli', 'electron', 'electron-builder', 'electron-updater']

function configTemplate(appName: string): string {
  return `import { defineDesktopConfig } from '@uni-helper/desktop'

export default defineDesktopConfig({
  app: {
    name: '${appName}',
    // A 512x512 PNG works for window icons and all installer targets
    // icon: 'static/logo.png',
  },
  window: {
    width: 420,
    height: 760,
  },
})
`
}

const DESKTOP_SCRIPTS: Record<string, string> = {
  'desktop:dev': 'uni-desktop dev',
  'desktop:build': 'uni-desktop build',
  'desktop:pack': 'uni-desktop pack',
}

/** Scaffold desktop.config.ts, wire scripts and manifest h5 settings, and install dependencies. */
export async function init(options: InitOptions = {}): Promise<void> {
  const root = resolve(options.cwd ?? process.cwd())
  const manifestPath = join(root, 'src/manifest.json')
  if (!existsSync(manifestPath))
    throw new DesktopError('src/manifest.json not found, run this inside a uni-app CLI project')

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, any>
  manifest.h5 ??= {}
  manifest.h5.router ??= {}
  let manifestChanged = false
  if (manifest.h5.router.mode !== 'hash') {
    manifest.h5.router.mode = 'hash'
    manifestChanged = true
  }
  if (manifest.h5.router.base !== './') {
    manifest.h5.router.base = './'
    manifestChanged = true
  }
  if (manifestChanged) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    log('updated manifest.json (h5.router mode "hash", base "./")')
  }

  const configPath = join(root, 'desktop.config.ts')
  if (!existsSync(configPath)) {
    await writeFile(configPath, configTemplate(manifest.name ?? 'uni-app-desktop'))
    log('created desktop.config.ts')
  }

  const mainPath = join(root, 'src/main.ts')
  if (existsSync(mainPath)) {
    const content = await readFile(mainPath, 'utf8')
    if (!content.includes('@uni-helper/desktop-shim')) {
      await writeFile(mainPath, `import '@uni-helper/desktop-shim'\n${content}`)
      log('added the shim import to src/main.ts')
    }
  }

  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  pkg.scripts ??= {}
  let scriptsChanged = false
  for (const [name, command] of Object.entries(DESKTOP_SCRIPTS)) {
    if (!pkg.scripts[name]) {
      pkg.scripts[name] = command
      scriptsChanged = true
    }
  }
  if (scriptsChanged) {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    log('added desktop:* scripts to package.json')
  }

  if (options.install !== false) {
    const pm = detectPackageManager(root)
    const hasDep = (name: string): boolean =>
      Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
    const runtimeDeps = RUNTIME_DEPS.filter(name => !hasDep(name))
    const devDeps = DEV_DEPS.filter(name => !hasDep(name))
    if (runtimeDeps.length > 0) {
      const { cmd, args } = addCommand(pm, runtimeDeps, false)
      await spawnAwait(cmd, args, { cwd: root })
    }
    if (devDeps.length > 0) {
      const { cmd, args } = addCommand(pm, devDeps, true)
      await spawnAwait(cmd, args, { cwd: root })
    }
  }

  log('done. Run `desktop:dev` to start the app, `desktop:build` to package installers.')
}
