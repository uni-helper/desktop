import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { DesktopError } from '../error'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

function hasLockfile(dir: string): PackageManager | undefined {
  if (existsSync(join(dir, 'pnpm-lock.yaml')))
    return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock')))
    return 'yarn'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock')))
    return 'bun'
  return undefined
}

/**
 * Detect the package manager from lockfiles, walking up so workspace members
 * resolve to their workspace's package manager.
 */
export function detectPackageManager(root: string): PackageManager {
  let current = resolve(root)
  for (;;) {
    const found = hasLockfile(current)
    if (found)
      return found
    const parent = dirname(current)
    if (parent === current)
      return 'npm'
    current = parent
  }
}

export function addCommand(pm: PackageManager, packages: string[], dev: boolean): { cmd: string, args: string[] } {
  switch (pm) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['add', dev ? '-D' : '', ...packages].filter(Boolean) }
    case 'yarn':
      return { cmd: 'yarn', args: ['add', dev ? '-D' : '', ...packages].filter(Boolean) }
    case 'bun':
      return { cmd: 'bun', args: ['add', dev ? '-d' : '', ...packages].filter(Boolean) }
    default:
      return { cmd: 'npm', args: ['install', dev ? '--save-dev' : '--save', ...packages] }
  }
}

export interface SpawnResult {
  code: number
}

export function spawnAwait(cmd: string, args: string[], options: { cwd: string, env?: NodeJS.ProcessEnv }): Promise<SpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', (error) => {
      rejectPromise(new DesktopError(`failed to run \`${cmd} ${args.join(' ')}\`: ${error.message}`))
    })
    child.once('exit', (code) => {
      if (code === 0)
        resolvePromise({ code })
      else
        rejectPromise(new DesktopError(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`))
    })
  })
}
