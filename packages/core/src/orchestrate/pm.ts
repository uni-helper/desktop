import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { DesktopError } from '../error'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml')))
    return 'pnpm'
  if (existsSync(join(root, 'yarn.lock')))
    return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock')))
    return 'bun'
  return 'npm'
}

export function runCommand(pm: PackageManager, script: string): { cmd: string, args: string[] } {
  switch (pm) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['run', script] }
    case 'yarn':
      return { cmd: 'yarn', args: [script] }
    case 'bun':
      return { cmd: 'bun', args: ['run', script] }
    default:
      return { cmd: 'npm', args: ['run', script] }
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
