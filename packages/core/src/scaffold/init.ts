import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { DesktopError } from '../error'
import { logger } from '../log'
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
  return `import { defineConfig } from '@uni-helper/desktop'

export default defineConfig({
  desktop: {
    app: {
      name: '${appName}',
      // A 512x512 PNG works for window icons and all installer targets
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
 * uni-app parses `manifest.json` with `jsonc-parser`, so comments and trailing
 * commas are valid there. Editing through the same parser keeps those intact
 * instead of round-tripping the file through `JSON.parse`/`stringify`.
 */
async function normalizeManifest(manifestPath: string): Promise<string | undefined> {
  const content = await readFile(manifestPath, 'utf8')
  const manifest = parse(content, [], { allowTrailingComma: true, disallowComments: false }) as
    { name?: string, h5?: { router?: { mode?: string, base?: string } } } | undefined

  if (!manifest || typeof manifest !== 'object')
    throw new DesktopError(`${manifestPath} is not a valid JSON object`)

  // Applied one at a time: when `h5.router` is missing both edits would create
  // the same parent object and jsonc-parser rejects the overlapping ranges.
  const formattingOptions = { insertSpaces: true, tabSize: 2 }
  let next = content
  for (const [path, value] of [['mode', 'hash'], ['base', './']] as const)
    next = applyEdits(next, modify(next, ['h5', 'router', path], value, { formattingOptions }))

  if (next !== content) {
    await writeFile(manifestPath, next)
    logger.success('updated manifest.json (h5.router mode "hash", base "./")')
  }
  return manifest.name
}

/** Insert the shim import as the first line, keeping the rest of the entry intact. */
async function ensureShimImport(mainPath: string): Promise<void> {
  if (!existsSync(mainPath))
    return
  const content = await readFile(mainPath, 'utf8')
  if (content.includes('@uni-helper/desktop-shim'))
    return
  await writeFile(mainPath, `import '@uni-helper/desktop-shim'\n${content}`)
  logger.success('added the shim import to src/main.ts')
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

  const pkgPath = join(root, 'package.json')
  const pkg = await ensureScripts(pkgPath)

  if (options.install !== false)
    await installDependencies(root, pkg)

  logger.success('done. Run `desktop:dev` to start the app, `desktop:build` to package installers.')
}
