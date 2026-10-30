import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { bakeConfig, resolveDesktopConfig } from '../src/config/resolve'

const tempDirs: string[] = []
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function createProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-'))
  tempDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, content)
  }
  // A TS `unh.config.ts` imports `@uni-helper/desktop`, so the temp project
  // needs the package resolvable like any real user install would have it.
  await mkdir(join(dir, 'node_modules/@uni-helper'), { recursive: true })
  await symlink(packageRoot, join(dir, 'node_modules/@uni-helper/desktop'), 'dir')
  return dir
}

describe('resolveDesktopConfig', () => {
  it('falls back to manifest values and defaults', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({
        name: 'my-uni-app',
        versionName: '2.3.4',
        h5: { title: 'My App', router: { mode: 'hash', base: './' } },
      }),
    })

    const { resolved, warnings } = await resolveDesktopConfig(root)

    expect(warnings).toEqual([])
    expect(resolved.appName).toBe('my-uni-app')
    expect(resolved.version).toBe('2.3.4')
    expect(resolved.appId).toBe('desktop.uniapp.my-uni-app')
    expect(resolved.window.title).toBe('My App')
    expect(resolved.window.width).toBe(420)
    expect(resolved.dev.url).toBe('http://localhost:5173')
    expect(resolved.build.command).toBe('build:h5')
    expect(resolved.pack.autoPack).toBe(true)
  })

  it('warns about history router and non-relative base', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({
        name: 'app',
        h5: { router: { mode: 'history', base: '/h5/' } },
      }),
    })

    const { warnings } = await resolveDesktopConfig(root)

    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('history')
    expect(warnings[1]).toContain('base')
  })

  it('lets unh.config.ts override the manifest', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'from-manifest', versionName: '1.0.0' }),
      'unh.config.json': JSON.stringify({
        desktop: {
          app: { name: 'from-config', appId: 'com.example.app', version: '9.9.9', icon: 'static/logo.png' },
          window: { title: 'Custom', width: 1280, height: 800 },
          dev: { url: 'http://localhost:3000' },
          tray: { icon: 'static/tray.png' },
          updater: { provider: 'github', autoDownload: false },
          pack: { autoPack: false, targets: { win: ['portable'] } },
        },
      }),
      'static/logo.png': 'png',
      'static/tray.png': 'png',
    })

    const { resolved, warnings } = await resolveDesktopConfig(root)

    expect(warnings).toEqual([])
    expect(resolved.appName).toBe('from-config')
    expect(resolved.appId).toBe('com.example.app')
    expect(resolved.version).toBe('9.9.9')
    expect(resolved.icon).toBe(join(root, 'static/logo.png'))
    expect(resolved.window).toMatchObject({ title: 'Custom', width: 1280, height: 800 })
    expect(resolved.dev.url).toBe('http://localhost:3000')
    expect(resolved.tray).toEqual({ icon: join(root, 'static/tray.png') })
    expect(resolved.updater).toEqual({ provider: 'github', autoDownload: false })
    expect(resolved.pack).toMatchObject({ autoPack: false, targets: { win: ['portable'] } })
  })

  it('loads a TypeScript config through unconfig', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'unh.config.ts': `import { defineConfig } from '@uni-helper/desktop'
export default defineConfig({ desktop: { window: { title: 'TS Title' } } })`,
    })

    const { resolved } = await resolveDesktopConfig(root)

    expect(resolved.window.title).toBe('TS Title')
  })

  it('ignores top-level keys owned by other tools', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'unh.config.json': JSON.stringify({
        somethingElse: { enabled: true },
        desktop: { window: { width: 1024 } },
      }),
    })

    const { resolved } = await resolveDesktopConfig(root)

    expect(resolved.window.width).toBe(1024)
    expect(resolved.appName).toBe('app')
  })

  it('falls back to defaults when the config has no desktop key', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'unh.config.json': JSON.stringify({}),
    })

    const { resolved } = await resolveDesktopConfig(root)

    expect(resolved.window.width).toBe(420)
    expect(resolved.pack.autoPack).toBe(true)
  })

  it('bakes asset file names instead of absolute paths', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'static/logo.png': 'png',
      'static/tray.png': 'png',
      'unh.config.json': JSON.stringify({
        desktop: {
          app: { icon: 'static/logo.png' },
          tray: { icon: 'static/tray.png' },
        },
      }),
    })

    const { resolved } = await resolveDesktopConfig(root)
    const baked = bakeConfig(resolved, { icon: 'icon.png', trayIcon: 'tray-icon.png' })

    expect(baked.icon).toBe('icon.png')
    expect(baked.tray).toMatchObject({ icon: 'tray-icon.png' })
    expect(JSON.stringify(baked)).not.toContain(root)
  })

  it('defaults the tray icon to the app icon', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'static/logo.png': 'png',
      'unh.config.json': JSON.stringify({
        desktop: {
          app: { icon: 'static/logo.png' },
          tray: { tooltip: 'Tray' },
        },
      }),
    })

    const { resolved } = await resolveDesktopConfig(root)

    expect(resolved.tray).toMatchObject({ icon: join(root, 'static/logo.png') })
  })

  it('falls back to the built-in uni-helper icon', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'unh.config.json': JSON.stringify({ desktop: { tray: { tooltip: 'Tray' } } }),
    })

    const { resolved } = await resolveDesktopConfig(root)

    // Without `app.icon` the window, tray and installers use the shipped icon
    // instead of Electron's own, so the paths point outside the project.
    expect(resolved.icon).not.toContain(root)
    expect(resolved.icon).toMatch(/assets[/\\]icon\.png$/)
    expect(resolved.tray).toMatchObject({ icon: resolved.icon })
  })

  it('fails loudly when a configured icon is missing', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'unh.config.json': JSON.stringify({ desktop: { app: { icon: 'static/missing.png' } } }),
    })

    await expect(resolveDesktopConfig(root)).rejects.toThrow('app icon not found at static/missing.png')
  })

  it('fills installer metadata from the project package.json', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'package.json': JSON.stringify({
        author: 'Example <dev@example.com>',
        homepage: 'https://example.com',
        description: 'Example app',
      }),
    })

    const { resolved } = await resolveDesktopConfig(root)

    expect(resolved.author).toBe('Example <dev@example.com>')
    expect(resolved.homepage).toBe('https://example.com')
    expect(resolved.description).toBe('Example app')
  })

  it('bakes a serializable config', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app', h5: { title: 'Baked' } }),
      'unh.config.json': JSON.stringify({ desktop: { tray: { icon: 'static/tray.png' } } }),
      'static/tray.png': 'png',
    })

    const { resolved } = await resolveDesktopConfig(root)
    const baked = bakeConfig(resolved)

    expect(baked.appName).toBe('app')
    expect(baked.window).toMatchObject({ title: 'Baked', width: 420, height: 760, center: true })
    // Only file names cross the boundary: absolute paths would break once the
    // assembled app directory is moved by electron-builder.
    expect(baked.tray).toMatchObject({ icon: undefined })
    expect(baked.updater).toBe(false)
    expect(JSON.parse(JSON.stringify(baked))).toEqual(baked)
  })
})
