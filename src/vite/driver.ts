import type { ChildProcess } from 'node:child_process'
import type { ResolvedConfig } from '../config/resolve'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { bakeConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { logger } from '../log'
import { prepareDevAppBundle } from '../orchestrate/app-bundle'
import { bundleEntry, bundlePreload } from '../orchestrate/bundle'
import { killTree, resolveElectronBinary } from '../orchestrate/electron'
import { packInternal } from '../orchestrate/pack'
import { copyAssets } from '../shared/assets'
import { APP_DIR } from '../shared/paths'
import { getTemplateDir, resolveMainEntry } from '../shared/templates'

export interface DesktopDevRuntimeHandle {
  close: () => Promise<void>
}

/**
 * Whether the running uni build targets the desktop platform: uni resolves the
 * custom script and exposes its `define` through `UNI_CUSTOM_CONTEXT`. Keys are
 * normalized the same way uni normalizes them (`-` to `_`, uppercased).
 */
export function isDesktopBuild(): boolean {
  const raw = process.env.UNI_CUSTOM_CONTEXT
  if (!raw)
    return false
  try {
    const context: unknown = JSON.parse(raw)
    if (context && typeof context === 'object' && !Array.isArray(context)) {
      return Object.entries(context as Record<string, unknown>).some(
        ([key, value]) => key.replace(/-/g, '_').toUpperCase() === 'DESKTOP' && Boolean(value),
      )
    }
  }
  catch {
    // A malformed value is uni's to reject, not ours to fail on.
  }
  return false
}

/**
 * Start the desktop shell around an already-running uni dev server: bundle the
 * main process in watch mode, bundle the preload script and open an Electron
 * window loading `url`. Main process changes restart the shell; renderer
 * changes hot-reload through the uni server.
 */
export async function startDesktopDevRuntime(resolved: ResolvedConfig, url: string): Promise<DesktopDevRuntimeHandle> {
  const root = resolved.root
  const outDir = join(root, '.uni-desktop/dev')
  const templateDir = getTemplateDir()

  logger.info(`launching the desktop shell for ${url}...`)

  // The runtime resolves assets relative to `__dirname/../resources`, and dev
  // writes `main.cjs` directly into `outDir`, so assets live one level up.
  const assetsDir = join(outDir, '..')
  await rm(outDir, { recursive: true, force: true })
  await rm(join(assetsDir, 'resources'), { recursive: true, force: true })
  const baked = bakeConfig(resolved, await copyAssets(resolved, assetsDir))

  const electronBinary = resolveElectronBinary(root)
  // On macOS the Dock reads the app name and icon from the running bundle, so
  // dev launches a renamed, re-iconed clone of the electron bundle instead of
  // the stock Electron.app; other platforms spawn the stock binary.
  const launchBinary = await prepareDevAppBundle({
    electronBinary,
    appName: resolved.appName,
    appId: resolved.appId,
    icon: resolved.icon,
    root,
  })

  // Declared before the watcher starts: a rebuild can land between the watcher
  // and the first spawn, and must then be a no-op instead of a second spawn.
  let electronProcess: ChildProcess | undefined
  let electronStarted = false
  const spawnElectron = (): void => {
    electronProcess = spawn(launchBinary, [join(outDir, 'main.cjs')], {
      cwd: root,
      env: { ...process.env, DESKTOP_DEV_URL: url },
      // The fourth channel carries IPC: the shell watches for it to close and
      // quits, so killing this process never leaves an orphan window behind.
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      detached: process.platform !== 'win32',
    })
    electronStarted = true
    electronProcess.once('exit', (code) => {
      logger.info(`electron exited with code ${code}`)
    })
    rejectOnSpawnError(electronProcess, 'electron').catch((error: DesktopError) => {
      logger.error(error.message)
    })
  }
  async function restartElectron(): Promise<void> {
    if (!electronStarted)
      return
    await killTree(electronProcess)
    spawnElectron()
  }

  const watcher = await bundleEntry({
    entryPath: resolveMainEntry(root, resolved.mainEntry),
    outDir,
    baked,
    watch: true,
    onRebuild: () => void restartElectron(),
  })
  await bundlePreload({ outDir, templateDir })
  spawnElectron()

  let closed = false
  return {
    async close() {
      if (closed)
        return
      closed = true
      await Promise.all([killTree(electronProcess), watcher?.dispose()])
    },
  }
}

/** Attach the error listener spawn needs so a missing binary rejects instead of crashing. */
function rejectOnSpawnError(emitter: ChildProcess, label: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    emitter.once('error', (error) => {
      reject(new DesktopError(`failed to start ${label}: ${error.message}`))
    })
  })
}

/**
 * Assemble the runnable Electron app directory at `dist/desktop` from a
 * finished uni build (`webDir`), and run electron-builder when `pack.autoPack`
 * is enabled. Runs inside the uni build process through the vite plugin.
 */
export async function assembleDesktopApp(resolved: ResolvedConfig, webDir: string): Promise<string> {
  const root = resolved.root
  const outDir = join(root, APP_DIR)
  const templateDir = getTemplateDir()
  const webTarget = join(outDir, 'web')

  if (!existsSync(join(webDir, 'index.html')))
    throw new DesktopError(`H5 build output not found at ${webDir}. Make sure the build runs \`uni build -p desktop\`.`)

  logger.start('assembling the electron app...')

  if (resolve(webDir) === webTarget) {
    // The uni build already wrote into the app dir: keep the fresh web
    // bundle and replace only the shell parts around it.
    await rm(join(outDir, 'electron'), { recursive: true, force: true })
    await rm(join(outDir, 'resources'), { recursive: true, force: true })
  }
  else {
    await rm(outDir, { recursive: true, force: true })
    await cp(webDir, webTarget, { recursive: true })
  }

  const assets = await copyAssets(resolved, outDir)
  const baked = bakeConfig(resolved, assets)

  const electronDir = join(outDir, 'electron')
  await bundleEntry({
    entryPath: resolveMainEntry(root, resolved.mainEntry),
    outDir: electronDir,
    baked,
  })
  await bundlePreload({ outDir: electronDir, templateDir })

  await writeFile(join(outDir, 'package.json'), `${JSON.stringify({
    name: resolved.appId.toLowerCase(),
    productName: resolved.appName,
    version: resolved.version,
    private: true,
    main: 'electron/main.cjs',
    description: resolved.description,
    author: resolved.author,
    homepage: resolved.homepage,
  }, null, 2)}\n`)

  logger.success(`desktop app assembled at ${outDir}`)

  if (resolved.pack.autoPack)
    await packInternal(root, resolved, outDir)

  return outDir
}
