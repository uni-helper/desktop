import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { addCommand, detectPackageManager } from '../src/orchestrate/pm'

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

  it('walks up to the nearest lockfile for workspace members', async () => {
    const parent = await projectWith(['pnpm-lock.yaml'])
    const child = join(parent, 'packages', 'app')
    await mkdir(child, { recursive: true })
    expect(detectPackageManager(child)).toBe('pnpm')
  })
})

describe('addCommand', () => {
  it('maps dev-dependency installs to package manager commands', () => {
    expect(addCommand('pnpm', ['electron'])).toEqual({ cmd: 'pnpm', args: ['add', '-D', 'electron'] })
    expect(addCommand('npm', ['electron'])).toEqual({ cmd: 'npm', args: ['install', '--save-dev', 'electron'] })
    expect(addCommand('yarn', ['a', 'b'])).toEqual({ cmd: 'yarn', args: ['add', '-D', 'a', 'b'] })
    expect(addCommand('bun', ['electron'])).toEqual({ cmd: 'bun', args: ['add', '-d', 'electron'] })
  })
})
