import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundleEntry, bundlePreload } from '../src/orchestrate/bundle'
import type { BakedDesktopConfig } from '../src/baked'

const outDir = join(tmpdir(), `uni-desktop-bundle-${Date.now()}`)
const templateDir = fileURLToPath(new URL('../src/templates', import.meta.url))
const shimSource = fileURLToPath(new URL('../../shim/src/index.ts', import.meta.url))

const baked: BakedDesktopConfig = {
  appName: 'bake-test-app',
  appId: 'desktop.uniapp.bake-test-app',
  version: '1.0.0',
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
      alias: { '@uni-helper/desktop-shim': shimSource },
    })

    const output = await readFile(join(outDir, 'main.cjs'), 'utf8')
    expect(output).toContain('BrowserWindow')
    expect(output).toContain('bake-test-app')
    expect(output).toContain('desktop.uniapp.bake-test-app')
    expect(output).not.toContain('__DESKTOP_CONFIG__)')
  })

  it('keeps electron external', async () => {
    await bundleEntry({
      entryPath: join(templateDir, 'main.ts'),
      outDir,
      baked,
      alias: { '@uni-helper/desktop-shim': shimSource },
    })

    const output = await readFile(join(outDir, 'main.cjs'), 'utf8')
    expect(output).toContain('require("electron")')
  })
})

describe('bundlePreload', () => {
  it('bundles the preload with the shim channel whitelist inlined', async () => {
    await bundlePreload({
      templateDir,
      outDir,
      alias: { '@uni-helper/desktop-shim': shimSource },
    })

    const output = await readFile(join(outDir, 'preload.cjs'), 'utf8')
    expect(output).toContain('contextBridge')
    expect(output).toContain('desktop:uni:setClipboardData')
    expect(output).toContain('desktop:uni:openDocument')
  })
})
