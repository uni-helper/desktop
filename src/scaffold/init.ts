import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { DesktopError } from '../error'
import { logger } from '../log'
import { addCommand, detectPackageManager, spawnAwait } from '../orchestrate/pm'
import { parseManifest } from '../shared/manifest'

export interface InitOptions {
  /** Project root, defaults to process.cwd() */
  cwd?: string
  /** Install the required dependencies after scaffolding, defaults to true */
  install?: boolean
}

const DEV_DEPS = ['@uni-helper/desktop', 'electron', 'electron-builder', 'electron-updater']

function configTemplate(appName: string): string {
  return `import { defineConfig } from '@uni-helper/desktop'

export default defineConfig({
  desktop: {
    app: {
      name: '${appName}',
      // A 512x512 PNG works for window icons and all installer targets.
      // Omit it to use the built-in uni-helper icon.
      // icon: 'static/logo.png',
    },
    window: {
      width: 420,
      height: 760,
    },
  },
})
`
}

const DESKTOP_SCRIPTS: Record<string, string> = {
  'desktop:dev': 'uni-desktop dev',
  'desktop:build': 'uni-desktop build',
  'desktop:pack': 'uni-desktop pack',
}

/**
 * Desktop apps load the H5 bundle from `file://`, which needs hash routing and
 * a relative base. `manifest.json` is uni-app json with `#ifdef` conditional
 * compilation, so edits go through `@uni-helper/jsonu` and keep the platform
 * blocks intact instead of round-tripping the file through `JSON.parse`.
 */
async function normalizeManifest(manifestPath: string): Promise<string | undefined> {
  const content = await readFile(manifestPath, 'utf8')
  const { doc, manifest } = parseManifest(content)

  if (!manifest)
    throw new DesktopError(`${manifestPath} is not a valid JSON object`)

  const router = manifest.h5?.router
  if (router?.mode !== 'hash' || router?.base !== './') {
    // Common (`*`) values: they win over leftover conditional members for H5
    // while other platforms keep their own data.
    doc.set('*', 'hash', ['h5', 'router', 'mode'])
    doc.set('*', './', ['h5', 'router', 'base'])
    await writeFile(manifestPath, `${doc.stringify()}\n`)
    logger.success('updated manifest.json (h5.router mode "hash", base "./")')
  }
  return manifest.name
}

/** Insert the shim import as the first line, keeping the rest of the entry intact. */
async function ensureShimImport(mainPath: string): Promise<void> {
  if (!existsSync(mainPath))
    return
  const content = await readFile(mainPath, 'utf8')
  if (content.includes('@uni-helper/desktop/shim'))
    return
  await writeFile(mainPath, `import '@uni-helper/desktop/shim'\n${content}`)
  logger.success('added the shim import to src/main.ts')
}

const VITE_CONFIG_TEMPLATE = `import uni from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'
import { uniDesktop } from '@uni-helper/desktop/vite'

export default defineConfig({
  plugins: [uni(), uniDesktop()],
})
`

/**
 * Wire the desktop vite plugin into the H5 build. Compiled builds route every
 * `uni.xxx` call through uni-h5's module exports, so without the plugin the
 * runtime shim never sees the calls (`desktop:build`/`desktop:pack` apps would
 * get uni-h5's "not supported" stubs for saveFile & co.).
 */
async function ensureViteConfig(root: string): Promise<void> {
  const configPath = join(root, 'vite.config.ts')
  if (!existsSync(configPath)) {
    await writeFile(configPath, VITE_CONFIG_TEMPLATE)
    logger.success('created vite.config.ts with the uniDesktop plugin')
    return
  }

  const content = await readFile(configPath, 'utf8')
  if (content.includes('@uni-helper/desktop/vite'))
    return
  if (!content.includes('plugins:')) {
    logger.warn('vite.config.ts has no `plugins` array; add uniDesktop() from @uni-helper/desktop/vite manually')
    return
  }

  let next = `import { uniDesktop } from '@uni-helper/desktop/vite'\n${content}`
  next = next.replace(/plugins:\s*\[/, 'plugins: [\n    uniDesktop(),')
  await writeFile(configPath, next)
  logger.success('added the uniDesktop plugin to vite.config.ts')
}

async function ensureScripts(pkgPath: string): Promise<{ scripts?: Record<string, string>, dependencies?: Record<string, string>, devDependencies?: Record<string, string> }> {
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const missing = Object.entries(DESKTOP_SCRIPTS).filter(([name]) => !pkg.scripts?.[name])
  if (missing.length === 0)
    return pkg

  pkg.scripts ??= {}
  for (const [name, command] of missing) pkg.scripts[name] = command
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  logger.success('added desktop:* scripts to package.json')
  return pkg
}

async function installDependencies(root: string, pkg: Awaited<ReturnType<typeof ensureScripts>>): Promise<void> {
  const pm = detectPackageManager(root)
  const hasDep = (name: string): boolean => Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])
  const devDeps = DEV_DEPS.filter(name => !hasDep(name))
  if (devDeps.length > 0) {
    const { cmd, args } = addCommand(pm, devDeps, true)
    await spawnAwait(cmd, args, { cwd: root })
  }
}

/** Scaffold unh.config.ts, wire scripts and manifest h5 settings, and install dependencies. */
export async function init(options: InitOptions = {}): Promise<void> {
  const root = resolve(options.cwd ?? process.cwd())
  const manifestPath = join(root, 'src/manifest.json')
  if (!existsSync(manifestPath))
    throw new DesktopError('src/manifest.json not found, run this inside a uni-app CLI project')

  const appName = await normalizeManifest(manifestPath)

  const configPath = join(root, 'unh.config.ts')
  if (!existsSync(configPath)) {
    await writeFile(configPath, configTemplate(appName ?? 'uni-app-desktop'))
    logger.success('created unh.config.ts')
  }

  await ensureShimImport(join(root, 'src/main.ts'))
  await ensureViteConfig(root)

  const pkgPath = join(root, 'package.json')
  const pkg = await ensureScripts(pkgPath)

  if (options.install !== false)
    await installDependencies(root, pkg)

  logger.success('done. Run `desktop:dev` to start the app, `desktop:build` to package installers.')
}
