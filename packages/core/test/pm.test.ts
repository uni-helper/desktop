import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { addCommand, detectPackageManager, runCommand } from '../src/orchestrate/pm'

const tempDirs: string[] = []

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function projectWith(lockfiles: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-pm-'))
  tempDirs.push(dir)
  for (const name of lockfiles) await writeFile(join(dir, name), '')
  return dir
}

describe('detectPackageManager', () => {
  it('detects from lockfiles and defaults to npm', async () => {
    expect(detectPackageManager(await projectWith(['pnpm-lock.yaml']))).toBe('pnpm')
    expect(detectPackageManager(await projectWith(['yarn.lock']))).toBe('yarn')
    expect(detectPackageManager(await projectWith(['bun.lockb']))).toBe('bun')
    expect(detectPackageManager(await projectWith([]))).toBe('npm')
    expect(detectPackageManager(await projectWith(['package-lock.json']))).toBe('npm')
  })
})

describe('runCommand', () => {
  it('maps scripts to package manager commands', () => {
    expect(runCommand('pnpm', 'dev:h5')).toEqual({ cmd: 'pnpm', args: ['run', 'dev:h5'] })
    expect(runCommand('npm', 'dev:h5')).toEqual({ cmd: 'npm', args: ['run', 'dev:h5'] })
    expect(runCommand('yarn', 'dev:h5')).toEqual({ cmd: 'yarn', args: ['dev:h5'] })
    expect(runCommand('bun', 'dev:h5')).toEqual({ cmd: 'bun', args: ['run', 'dev:h5'] })
  })
})

describe('addCommand', () => {
  it('maps installs to package manager commands', () => {
    expect(addCommand('pnpm', ['electron'], true)).toEqual({ cmd: 'pnpm', args: ['add', '-D', 'electron'] })
    expect(addCommand('npm', ['electron'], true)).toEqual({ cmd: 'npm', args: ['install', '--save-dev', 'electron'] })
    expect(addCommand('yarn', ['a', 'b'], false)).toEqual({ cmd: 'yarn', args: ['add', 'a', 'b'] })
    expect(addCommand('bun', ['electron'], true)).toEqual({ cmd: 'bun', args: ['add', '-d', 'electron'] })
  })
})
