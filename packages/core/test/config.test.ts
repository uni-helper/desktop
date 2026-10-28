import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { bakeConfig, resolveDesktopConfig } from '../src/config/resolve'

const tempDirs: string[] = []

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

  it('lets desktop.config.ts override the manifest', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'from-manifest', versionName: '1.0.0' }),
      'desktop.config.json': JSON.stringify({
        app: { name: 'from-config', appId: 'com.example.app', version: '9.9.9', icon: 'static/logo.png' },
        window: { title: 'Custom', width: 1280, height: 800 },
        dev: { url: 'http://localhost:3000' },
        tray: { icon: 'static/tray.png' },
        updater: { provider: 'github', autoDownload: false },
        pack: { autoPack: false, targets: { win: ['portable'] } },
      }),
      'static/logo.png': 'png',
      'static/tray.png': 'png',
    })

    const { resolved, warnings } = await resolveDesktopConfig(root)

    expect(warnings).toEqual([])
    expect(resolved.appName).toBe('from-config')
    expect(resolved.appId).toBe('com.example.app')
    expect(resolved.version).toBe('9.9.9')
    expect(resolved.icon).toBe('static/logo.png')
    expect(resolved.window).toMatchObject({ title: 'Custom', width: 1280, height: 800 })
    expect(resolved.dev.url).toBe('http://localhost:3000')
    expect(resolved.tray).toEqual({ icon: 'static/tray.png' })
    expect(resolved.updater).toEqual({ provider: 'github', autoDownload: false })
    expect(resolved.pack).toMatchObject({ autoPack: false, targets: { win: ['portable'] } })
  })

  it('loads a TypeScript config through unconfig', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'desktop.config.ts': `import { defineDesktopConfig } from '@uni-helper/desktop'
export default defineDesktopConfig({ window: { title: 'TS Title' } })`,
    })

    const { resolved } = await resolveDesktopConfig(root)

    expect(resolved.window.title).toBe('TS Title')
  })

  it('bakes a serializable config', async () => {
    const root = await createProject({
      'src/manifest.json': JSON.stringify({ name: 'app', h5: { title: 'Baked' } }),
      'desktop.config.json': JSON.stringify({ tray: { icon: 'static/tray.png' } }),
      'static/tray.png': 'png',
    })

    const { resolved } = await resolveDesktopConfig(root)
    const baked = bakeConfig(resolved)

    expect(baked.appName).toBe('app')
    expect(baked.window).toMatchObject({ title: 'Baked', width: 420, height: 760, center: true })
    expect(baked.tray).toMatchObject({ iconPath: join(root, 'static/tray.png') })
    expect(baked.updater).toBe(false)
    expect(JSON.parse(JSON.stringify(baked))).toEqual(baked)
  })
})
