import type { ChildProcess } from 'node:child_process'
import type { ResolvedConfig } from '../config/resolve'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { bakeConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { logger } from '../log'
import { prepareDevAppBundle } from '../orchestrate/app-bundle'
import { bundleEntry, bundlePreload } from '../orchestrate/bundle'
import { killTree, resolveElectronBinary } from '../orchestrate/electron'
import { packInternal } from '../orchestrate/pack'
import { copyAssets } from '../shared/assets'
import { BUILD_APP_DIR, DEV_APP_DIR } from '../shared/paths'
import { getTemplateDir, resolveMainEntry } from '../shared/templates'

export interface DesktopDevRuntimeHandle {
  close: () => Promise<void>
}

/**
 * Whether the running uni build targets the desktop platform: uni resolves the
 * custom script and exposes its `define` through `UNI_CUSTOM_CONTEXT`. Keys are
 * normalized the same way uni normalizes them (`-` to `_`, uppercased). The
 * value is always JSON uni itself stringified, so a malformed one fails loudly
 * instead of silently skipping the whole desktop pipeline.
 */
export function isDesktopBuild(): boolean {
  const raw = process.env.UNI_CUSTOM_CONTEXT
  if (!raw)
    return false
  const context = JSON.parse(raw) as Record<string, unknown>
  return Object.entries(context).some(
    ([key, value]) => key.replace(/-/g, '_').toUpperCase() === 'DESKTOP' && Boolean(value),
  )
}

/**
 * Start the desktop shell around an already-running uni dev server: bundle the
 * main process in watch mode, bundle the preload script and open an Electron
 * window loading `url`. Main process changes restart the shell; renderer
 * changes hot-reload through the uni server.
 */
export async function startDesktopDevRuntime(resolved: ResolvedConfig, url: string): Promise<DesktopDevRuntimeHandle> {
  const root = resolved.root
  const outDir = join(root, DEV_APP_DIR)
  const electronDir = join(outDir, 'electron')
  const templateDir = getTemplateDir()

  // Fresh runtime parts each start, laid out like the built app (electron/
  // next to resources/); the macOS shell cache in `electron-cache` survives so
  // a dev restart does not pay for another bundle clone.
  await rm(electronDir, { recursive: true, force: true })
  await rm(join(outDir, 'resources'), { recursive: true, force: true })
  const baked = bakeConfig(resolved, await copyAssets(resolved, outDir))

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
    electronProcess = spawn(launchBinary, [join(electronDir, 'main.cjs')], {
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
    // A spawn failure (e.g. the binary vanished) must not crash the uni process.
    electronProcess.once('error', (error) => {
      logger.error(`failed to start electron: ${error.message}`)
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
    outDir: electronDir,
    baked,
    watch: true,
    onRebuild: () => void restartElectron(),
  })
  await bundlePreload({ outDir: electronDir, templateDir })
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

/**
 * Assemble the runnable Electron app directory at `dist/build/desktop` from a
 * finished uni build (`webDir`), and run electron-builder when `pack.autoPack`
 * is enabled. Runs inside the uni build process through the vite plugin.
 */
export async function assembleDesktopApp(resolved: ResolvedConfig, webDir: string): Promise<string> {
  const root = resolved.root
  const outDir = join(root, BUILD_APP_DIR)
  const templateDir = getTemplateDir()
  const webTarget = join(outDir, 'web')

  if (!existsSync(join(webDir, 'index.html')))
    throw new DesktopError(`H5 build output not found at ${webDir}. Make sure the build runs \`uni build -p desktop\`.`)

  logger.start('assembling the electron app...')

  // uni's h5 build wrote next door (`dist/build/h5`): claim it wholesale with
  // a same-disk rename instead of copying, leaving no `h5` dir behind.
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  await rename(webDir, webTarget)

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
