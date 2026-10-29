import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { BuildContext } from 'esbuild'
import { bakeConfig, resolveDesktopConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { log } from '../log'
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
  close(): Promise<void>
}

/** Directory holding the shipped `main.ts` / `preload.ts` templates. */
export function getTemplateDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'templates')
}

function resolveMainEntryPath(root: string, mainEntry: string | undefined, templateDir: string): string {
  return mainEntry ? join(root, mainEntry) : join(templateDir, 'main.ts')
}

/**
 * Start the H5 dev server, wait for `dev.url` to become reachable, then launch
 * an Electron window loading it. Main process changes trigger an Electron
 * restart, renderer changes hot-reload through Vite.
 */
export async function dev(options: DevOptions = {}): Promise<DevHandle> {
  const { resolved, warnings } = await resolveDesktopConfig(options.cwd)
  for (const warning of warnings) log(warning)
  const root = resolved.root
  const url = options.url ?? resolved.dev.url
  const outDir = join(root, '.uni-desktop/dev')
  const templateDir = getTemplateDir()

  const pm = detectPackageManager(root)
  const { cmd, args } = runCommand(pm, resolved.dev.command)
  log(`starting \`${resolved.dev.command}\` via ${pm}...`)
  const server = spawn(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  })
  const serverFailed = new Promise<never>((_, reject) => {
    server.once('exit', (code) => {
      reject(new DesktopError(`\`${resolved.dev.command}\` exited with code ${code} before the dev server became ready at ${url}`))
    })
  })

  log(`waiting for the dev server at ${url}...`)
  await Promise.race([
    waitUntilReady(url, { timeout: resolved.dev.waitTimeout, interval: resolved.dev.interval }),
    serverFailed,
  ])

  await rm(outDir, { recursive: true, force: true })
  const baked = bakeConfig(resolved)

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
      log(`electron exited with code ${code}`)
    })
  }
  async function restartElectron(): Promise<void> {
    if (!electronStarted)
      return
    killTree(electronProcess)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
    spawnElectron()
  }

  const watcher = await bundleEntry({
    entryPath: resolveMainEntryPath(root, resolved.mainEntry, templateDir),
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
      killTree(electronProcess)
      killTree(server)
      await watcher?.dispose()
    },
  }
}
