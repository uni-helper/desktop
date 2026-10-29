import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { bakeConfig, resolveDesktopConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { logger } from '../log'
import { copyAssets } from '../shared/assets'
import { getTemplateDir, resolveMainEntry } from '../shared/templates'
import { bundleEntry, bundlePreload } from './bundle'
import { killTree, resolveElectronBinary } from './electron'
import { detectPackageManager, runCommand } from './pm'
import { waitUntilReady } from './probe'

export interface DevOptions {
  /** Project root, defaults to process.cwd() */
  cwd?: string
  /** Overrides `dev.url` from the config */
  url?: string
}

export interface DevHandle {
  close: () => Promise<void>
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
 * Start the H5 dev server, wait for `dev.url` to become reachable, then launch
 * an Electron window loading it. Main process changes trigger an Electron
 * restart, renderer changes hot-reload through Vite.
 */
export async function dev(options: DevOptions = {}): Promise<DevHandle> {
  const { resolved, warnings } = await resolveDesktopConfig(options.cwd)
  for (const warning of warnings) logger.warn(warning)
  const root = resolved.root
  const url = options.url ?? resolved.dev.url
  const outDir = join(root, '.uni-desktop/dev')
  const templateDir = getTemplateDir()

  const pm = detectPackageManager(root)
  const { cmd, args } = runCommand(pm, resolved.dev.command)
  logger.start(`starting \`${resolved.dev.command}\` via ${pm}...`)
  const server = spawn(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  })

  // Without an `error` listener a missing executable crashes the process with
  // an uncaught ENOENT instead of a readable message.
  const serverFailed = Promise.race([
    rejectOnSpawnError(server, `\`${resolved.dev.command}\``),
    new Promise<never>((_, reject) => {
      server.once('exit', (code) => {
        reject(new DesktopError(`\`${resolved.dev.command}\` exited with code ${code} before the dev server became ready at ${url}`))
      })
    }),
  ])
  // `serverFailed` may settle after the race below has already been won; keep
  // that rejection handled so Node does not turn it into an unhandled rejection.
  serverFailed.catch(() => {})

  logger.info(`waiting for the dev server at ${url}...`)
  await Promise.race([
    waitUntilReady(url, { timeout: resolved.dev.waitTimeout, interval: resolved.dev.interval }),
    serverFailed,
  ])
  logger.success(`dev server is ready at ${url}, launching electron...`)

  // The runtime resolves assets relative to `__dirname/../resources`, and dev
  // writes `main.cjs` directly into `outDir`, so assets live one level up.
  await rm(outDir, { recursive: true, force: true })
  const assetsDir = join(outDir, '..')
  await rm(join(assetsDir, 'resources'), { recursive: true, force: true })
  const baked = bakeConfig(resolved, await copyAssets(resolved, assetsDir))

  // Declared before the watcher starts: esbuild fires `onRebuild` for the
  // initial build as soon as `watch()` resolves, which can race ahead of the
  // statements below.
  const electronBinary = resolveElectronBinary(root)
  let electronProcess: ChildProcess | undefined
  let electronStarted = false
  const spawnElectron = (): void => {
    electronProcess = spawn(electronBinary, [join(outDir, 'main.cjs')], {
      cwd: root,
      env: { ...process.env, DESKTOP_DEV_URL: url },
      stdio: 'inherit',
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
      await Promise.all([killTree(electronProcess), killTree(server), watcher?.dispose()])
    },
  }
}
