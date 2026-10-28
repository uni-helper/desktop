import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DesktopError } from '../error'
import type { ChildProcess } from 'node:child_process'

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

/** Kill a spawned process and, on POSIX, its whole process group. */
export function killTree(child: ChildProcess | undefined): void {
  if (!child?.pid || child.exitCode !== null)
    return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  }
  catch {
    child.kill('SIGTERM')
  }
}
