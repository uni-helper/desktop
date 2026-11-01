import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopConfig } from '../src/config/resolve'
import { startDesktopDevRuntime } from '../src/vite/driver'

const state = vi.hoisted(() => ({
  spawnCalls: 0,
  killCalls: 0,
  disposeCalls: 0,
  onRebuild: undefined as undefined | (() => void),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    state.spawnCalls++
    return { pid: 1234, exitCode: null, signalCode: null, once: vi.fn() }
  }),
}))
vi.mock('../src/orchestrate/electron', () => ({
  killTree: vi.fn(async () => { state.killCalls++ }),
  resolveElectronBinary: vi.fn(() => '/fake/electron'),
}))
vi.mock('../src/orchestrate/app-bundle', () => ({
  prepareDevAppBundle: vi.fn(async (o: { electronBinary: string }) => o.electronBinary),
}))
vi.mock('../src/orchestrate/bundle', () => ({
  bundleEntry: vi.fn(async (o: { onRebuild?: () => void }) => {
    state.onRebuild = o.onRebuild
    return {
      dispose: vi.fn(async () => {
        state.disposeCalls++
      }),
    }
  }),
  bundlePreload: vi.fn(async () => {}),
}))
vi.mock('../src/shared/assets', () => ({
  copyAssets: vi.fn(async () => ({ icon: 'icon.png' })),
}))

const tempDirs: string[] = []
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

beforeEach(() => {
  Object.assign(state, { spawnCalls: 0, killCalls: 0, disposeCalls: 0, onRebuild: undefined })
})

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function createResolved(): Promise<any> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-restart-'))
  tempDirs.push(dir)
  await writeFile(`${dir}/package.json`, JSON.stringify({ name: 'restart-test', version: '1.0.0' }))
  await mkdir(join(dir, 'node_modules/@uni-helper'), { recursive: true })
  await symlink(packageRoot, join(dir, 'node_modules/@uni-helper/desktop'), 'dir')
  const { resolved } = await resolveDesktopConfig(dir)
  resolved.root = dir
  return resolved
}

async function flush(): Promise<void> {
  await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
}

describe('startDesktopDevRuntime restart lifecycle', () => {
  it('two overlapping rebuilds spawn exactly once more', async () => {
    const resolved = await createResolved()

    await startDesktopDevRuntime(resolved, 'http://localhost:5173')
    await vi.waitFor(() => expect(state.spawnCalls).toBe(1))

    state.onRebuild!()
    state.onRebuild!()
    await flush()

    // One kill-then-spawn for the burst: the second rebuild chains onto the
    // first and sees the fresh process instead of double-killing.
    expect(state.spawnCalls).toBe(2)
    expect(state.killCalls).toBe(1)
  })

  it('close prevents respawns and disposes the watcher', async () => {
    const resolved = await createResolved()

    const handle = await startDesktopDevRuntime(resolved, 'http://localhost:5173')
    await vi.waitFor(() => expect(state.spawnCalls).toBe(1))

    state.onRebuild!()
    await handle.close()
    await flush()

    expect(state.spawnCalls).toBe(1)
    expect(state.killCalls).toBe(1)
    expect(state.disposeCalls).toBe(1)

    state.onRebuild!()
    await flush()
    expect(state.spawnCalls).toBe(1)
  })

  it('close is idempotent', async () => {
    const resolved = await createResolved()

    const handle = await startDesktopDevRuntime(resolved, 'http://localhost:5173')
    await vi.waitFor(() => expect(state.spawnCalls).toBe(1))

    await handle.close()
    await handle.close()
    await flush()

    expect(state.killCalls).toBe(1)
    expect(state.disposeCalls).toBe(1)
  })
})
