import type { ResolveResult } from '../config/resolve'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import * as clack from '@clack/prompts'
import { resolveDesktopConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { logger } from '../log'
import { addCommand, detectPackageManager, spawnAwait } from '../orchestrate/pm'
import { parseManifest } from '../shared/manifest'
import { DESKTOP_SCRIPT_NAME } from '../shared/scripts'

/** npm scripts that run the desktop platform through uni's own CLI. */
const DESKTOP_SCRIPTS: Record<string, string> = {
  'dev:desktop': 'uni -p desktop',
  'build:desktop': 'uni build -p desktop',
}

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

interface ProjectPackage {
  'scripts'?: Record<string, string>
  'dependencies'?: Record<string, string>
  'devDependencies'?: Record<string, string>
  'uni-app'?: {
    scripts?: Record<string, { env?: { UNI_PLATFORM?: string }, define?: Record<string, unknown> }>
  }
}

async function readPackageJson(root: string): Promise<ProjectPackage> {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as ProjectPackage
}

/**
 * Verify the desktop custom platform entry uni resolved for this build. The
 * `H5`/`WEB` false keys are what make `#ifdef H5` stay browser-only, so a
 * user-maintained entry without them changes compile semantics; surface that
 * instead of silently rewriting their define.
 */
function checkDesktopUniScript(pkg: ProjectPackage): void {
  const script = pkg['uni-app']?.scripts?.[DESKTOP_SCRIPT_NAME]
  if (!script)
    throw new DesktopError(`package.json has no \`uni-app.scripts.${DESKTOP_SCRIPT_NAME}\` custom platform`)
  if (script.env?.UNI_PLATFORM !== 'h5')
    throw new DesktopError(`\`uni-app.scripts.${DESKTOP_SCRIPT_NAME}.env.UNI_PLATFORM\` must be "h5" for desktop builds`)
  const define = script.define ?? {}
  const missing = ['H5', 'WEB'].filter(key => define[key] !== false)
  if (missing.length > 0)
    logger.warn(`uni-app.scripts.${DESKTOP_SCRIPT_NAME}.define lacks ${missing.map(key => `"${key}": false`).join(', ')}; without them #ifdef ${missing.join('/#ifdef ')} code is kept in desktop builds`)
}

/**
 * User-file writes must be atomic: a torn package.json or manifest.json (crash,
 * disk-full mid-write) breaks the whole project, while a rename over the target
 * is all-or-nothing on the same filesystem.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.uni-desktop-tmp`
  await writeFile(tempPath, content)
  await rename(tempPath, filePath)
}

/** npm scripts are pure conveniences: add the ones that are missing, quietly. */
async function ensureDesktopScripts(root: string, pkg: ProjectPackage): Promise<void> {
  const pkgPath = join(root, 'package.json')
  const missing = Object.entries(DESKTOP_SCRIPTS).filter(([name]) => !pkg.scripts?.[name])
  if (missing.length === 0)
    return
  pkg.scripts ??= {}
  for (const [name, command] of missing) pkg.scripts[name] = command
  await writeFileAtomic(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  logger.success(`added ${missing.map(([name]) => name).join(', ')} to package.json`)
}

/**
 * Desktop apps load the built bundle from `file://`, which needs hash routing
 * and a relative base. Edits go through `@uni-helper/jsonu` so `#ifdef`
 * conditional compilation survives the round-trip.
 */
async function ensureManifestRouter(root: string, interactive: boolean): Promise<void> {
  const manifestPath = join(root, 'src/manifest.json')
  if (!existsSync(manifestPath))
    return
  const { doc, manifest } = parseManifest(await readFile(manifestPath, 'utf8'))
  if (!manifest)
    throw new DesktopError(`${manifestPath} is not a valid JSON object`)
  const router = manifest.h5?.router
  if (router?.mode === 'hash' && router?.base === './')
    return

  const message = 'manifest.json needs h5.router mode "hash" and base "./" so the built app loads from file://. Fix it now?'
  if (interactive) {
    const answer = await clack.confirm({ message, initialValue: true })
    if (clack.isCancel(answer) || !answer) {
      logger.warn('skipped manifest.json normalization; pages may be blank when loaded from file://')
      return
    }
  }
  // Common (`*`) values: they win over leftover conditional members while
  // other platforms keep their own data.
  doc.set('*', 'hash', ['h5', 'router', 'mode'])
  doc.set('*', './', ['h5', 'router', 'base'])
  await writeFileAtomic(manifestPath, `${doc.stringify()}\n`)
  logger.success('updated manifest.json (h5.router mode "hash", base "./")')
}

async function ensureUnhConfig(root: string, appName: string): Promise<void> {
  const configPath = join(root, 'unh.config.ts')
  if (existsSync(configPath))
    return
  await writeFile(configPath, configTemplate(appName))
  logger.success('created unh.config.ts')
}

/** Offer to install the electron tooling the current command is about to need. */
async function ensureDependencies(root: string, pkg: ProjectPackage, needsPack: boolean, needsUpdater: boolean, interactive: boolean): Promise<void> {
  const has = (name: string): boolean => Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])
  const needed: string[] = []
  if (!has('electron'))
    needed.push('electron')
  if (needsPack && !has('electron-builder'))
    needed.push('electron-builder')
  if (needsUpdater && !has('electron-updater'))
    needed.push('electron-updater')
  if (needed.length === 0)
    return

  const message = `Install the missing dependencies (${needed.join(', ')})?`
  let install = false
  if (interactive) {
    const answer = await clack.confirm({ message, initialValue: true })
    install = !clack.isCancel(answer) && answer
  }
  if (!install) {
    logger.warn(`missing dependencies: ${needed.join(', ')}; install them e.g. with \`pnpm add -D ${needed.join(' ')}\``)
    return
  }
  const pm = detectPackageManager(root)
  const { cmd, args } = addCommand(pm, needed)
  logger.start(`installing ${needed.join(', ')} via ${pm}...`)
  await spawnAwait(cmd, args, { cwd: root })
}

let checkedRoot: string | undefined

/**
 * Bring a uni-app project up to desktop shape, then resolve its config. Runs
 * the checks once per project root per process (dev and build hooks may both
 * fire). In a TTY, rewriting user files asks for confirmation; non-interactive
 * runs (CI, piped output) auto-apply the safe fixes and only warn for the rest.
 */
export async function ensureDesktopProject(
  root: string,
  options: { interactive?: boolean } = {},
): Promise<ResolveResult> {
  const interactive = options.interactive ?? process.stdout.isTTY === true
  if (checkedRoot !== root) {
    checkedRoot = root
    // One package.json read flows through every check below; adding scripts
    // never touches dependencies, so the shared object stays valid.
    const pkg = await readPackageJson(root)
    // Validate the platform entry first: an unusable one should stop the run
    // before any file gets rewritten.
    checkDesktopUniScript(pkg)
    await ensureManifestRouter(root, interactive)
    await ensureDesktopScripts(root, pkg)
    const probe = await resolveDesktopConfig(root)
    await ensureUnhConfig(root, probe.resolved.appName)
    await ensureDependencies(root, pkg, probe.resolved.pack.autoPack, probe.resolved.updater !== false, interactive)
  }

  const result = await resolveDesktopConfig(root)
  for (const warning of result.warnings) logger.warn(warning)
  return result
}
