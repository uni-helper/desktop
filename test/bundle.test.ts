import type { BakedDesktopConfig } from '../src/baked'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bundleEntry, bundlePreload } from '../src/orchestrate/bundle'

const outDir = join(tmpdir(), `uni-desktop-bundle-${Date.now()}`)
const templateDir = fileURLToPath(new URL('../src/templates', import.meta.url))
const shimSource = fileURLToPath(new URL('../src/shim/index.ts', import.meta.url))
const shimChannelsSource = fileURLToPath(new URL('../src/shim/channels.ts', import.meta.url))

const baked: BakedDesktopConfig = {
  appName: 'bake-test-app',
  window: {
    title: 'Bake Test',
    width: 420,
    height: 760,
    center: true,
    resizable: true,
    fullscreen: false,
    frame: true,
    autoHideMenuBar: true,
    show: true,
    alwaysOnTop: false,
    kiosk: false,
  },
  dev: { openDevtools: false },
  tray: false,
  updater: false,
}

beforeAll(async () => {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
})

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('bundleEntry', () => {
  it('bundles the default main template with the baked config injected', async () => {
    await bundleEntry({
      entryPath: join(templateDir, 'main.ts'),
      outDir,
      baked,
      alias: { '@uni-helper/desktop/shim': shimSource, '@uni-helper/desktop/shim/channels': shimChannelsSource },
    })

    const output = await readFile(join(outDir, 'main.cjs'), 'utf8')
    expect(output).toContain('BrowserWindow')
    expect(output).toContain('bake-test-app')
    expect(output).not.toContain('__DESKTOP_CONFIG__)')
  })

  it('keeps electron external', async () => {
    await bundleEntry({
      entryPath: join(templateDir, 'main.ts'),
      outDir,
      baked,
      alias: { '@uni-helper/desktop/shim': shimSource, '@uni-helper/desktop/shim/channels': shimChannelsSource },
    })

    const output = await readFile(join(outDir, 'main.cjs'), 'utf8')
    expect(output).toContain('require("electron")')
  })

  it('bundles electron-updater so a packaged app can auto-update', async () => {
    await bundleEntry({
      entryPath: join(templateDir, 'main.ts'),
      outDir,
      baked,
      alias: { '@uni-helper/desktop/shim': shimSource, '@uni-helper/desktop/shim/channels': shimChannelsSource },
    })

    const output = await readFile(join(outDir, 'main.cjs'), 'utf8')
    // Externalized, the packaged app (no node_modules in the asar) could not
    // resolve electron-updater and auto update silently died.
    expect(output).not.toContain('require("electron-updater")')
    expect(output).toContain('autoUpdater')
  })
})

describe('bundleEntry watch', () => {
  it('fires onRebuild for real changes only, not the initial build', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-bundle-watch-'))
    const outDir = join(dir, 'out')
    const entry = join(dir, 'entry.ts')
    await writeFile(entry, 'export const version = 1\n')

    let rebuilds = 0
    const watcher = await bundleEntry({
      entryPath: entry,
      outDir,
      baked,
      watch: true,
      onRebuild: () => rebuilds++,
    })
    try {
      // The initial build's onEnd must not count as a rebuild.
      await vi.waitFor(() => expect(existsSync(join(outDir, 'main.cjs'))).toBe(true))
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
      expect(rebuilds).toBe(0)

      await writeFile(entry, 'export const version = 2\n')
      await vi.waitFor(() => expect(rebuilds).toBe(1))
    }
    finally {
      await watcher?.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)
})

describe('bundlePreload', () => {
  it('bundles the preload with the shim channel whitelist inlined', async () => {
    await bundlePreload({
      templateDir,
      outDir,
      alias: { '@uni-helper/desktop/shim': shimSource, '@uni-helper/desktop/shim/channels': shimChannelsSource },
    })

    const output = await readFile(join(outDir, 'preload.cjs'), 'utf8')
    expect(output).toContain('contextBridge')
    expect(output).toContain('desktop:uni:saveFile')
    expect(output).toContain('desktop:uni:openDocument')
  })
})
