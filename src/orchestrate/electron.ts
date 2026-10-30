import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { DesktopError } from '../error'

/** Resolve the electron binary path from the project's own dependencies. */
export function resolveElectronBinary(root: string): string {
  const require = createRequire(join(root, 'package.json'))
  let entry: string
  try {
    entry = require.resolve('electron')
  }
  catch {
    throw new DesktopError('electron is not installed. Run `pnpm add -D electron` in your project first.')
  }
  try {
    const binary = require(entry) as unknown
    if (typeof binary !== 'string')
      throw new DesktopError('`electron` did not resolve to a binary path, try reinstalling it')
    return binary
  }
  catch (error) {
    if (error instanceof DesktopError)
      throw error
    throw new DesktopError('electron is installed but its binary is missing, reinstall it (e.g. `pnpm rebuild electron`)')
  }
}

const KILL_TIMEOUT = 5000

/**
 * Kill a spawned process and, on POSIX, its whole process group. Resolves once
 * the process is gone, escalating to SIGKILL when it ignores SIGTERM, so callers
 * never leak an orphan that keeps the port or the window alive.
 */
export function killTree(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve()

  const pid = child.pid
  const exited = new Promise<void>((resolvePromise) => {
    child.once('exit', () => resolvePromise())
    child.once('error', () => resolvePromise())
  })

  const signal = (sig: NodeJS.Signals): void => {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    try {
      process.kill(-pid, sig)
    }
    catch {
      child.kill(sig)
    }
  }

  signal('SIGTERM')

  return Promise.race([
    exited,
    new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => {
        signal('SIGKILL')
        resolvePromise()
      }, KILL_TIMEOUT)
      timer.unref()
      void exited.then(() => {
        clearTimeout(timer)
        resolvePromise()
      })
    }),
  ])
}
