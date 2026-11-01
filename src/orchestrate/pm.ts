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

/** Command that installs the packages as dev dependencies of the project. */
export function addCommand(pm: PackageManager, packages: string[]): { cmd: string, args: string[] } {
  switch (pm) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['add', '-D', ...packages] }
    case 'yarn':
      return { cmd: 'yarn', args: ['add', '-D', ...packages] }
    case 'bun':
      return { cmd: 'bun', args: ['add', '-d', ...packages] }
    default:
      return { cmd: 'npm', args: ['install', '--save-dev', ...packages] }
  }
}

/**
 * cmd.exe (Node's `shell: true` on Windows) joins the command and arguments
 * with raw spaces, so any argument containing whitespace must carry its own
 * quotes. Doubling embedded quotes is cmd.exe's own escaping for `""` inside
 * a quoted string.
 */
export function quoteWindowsArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

export function spawnAwait(cmd: string, args: string[], options: { cwd: string }): Promise<void> {
  const windowsShell = process.platform === 'win32'
  const effectiveArgs = windowsShell ? args.map(quoteWindowsArg) : args
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, effectiveArgs, {
      cwd: options.cwd,
      stdio: 'inherit',
      shell: windowsShell,
    })
    child.once('error', (error) => {
      rejectPromise(new DesktopError(`failed to run \`${cmd} ${args.join(' ')}\`: ${error.message}`))
    })
    child.once('exit', (code) => {
      if (code === 0)
        resolvePromise()
      else
        rejectPromise(new DesktopError(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`))
    })
  })
}
