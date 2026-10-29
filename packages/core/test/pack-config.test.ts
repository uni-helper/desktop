import type { DesktopConfig } from '../src/types'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config/resolve'
import { createElectronBuilderConfig } from '../src/orchestrate/pack'

let projectRoot: string

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'uni-desktop-pack-'))
  await mkdir(join(projectRoot, 'static'), { recursive: true })
  await writeFile(join(projectRoot, 'static/logo.png'), 'png')
  await writeFile(join(projectRoot, 'static/logo.jpg'), 'jpg')
})

afterAll(async () => {
  await rm(projectRoot, { recursive: true, force: true })
})

function resolve(config: DesktopConfig) {
  return normalizeConfig(config, { name: 'app', versionName: '1.0.0' }, projectRoot)
}

const electronVersion = '45.0.0'

describe('createElectronBuilderConfig', () => {
  it('generates defaults for all platforms', () => {
    const config = createElectronBuilderConfig(resolve({}), projectRoot, electronVersion)

    expect(config).toMatchObject({
      appId: 'desktop.uniapp.app',
      productName: 'app',
      asar: true,
      electronVersion: '45.0.0',
    })
    expect((config as any).directories.output).toBe(join(projectRoot, 'dist/release'))
    expect((config as any).win.target).toEqual(['nsis'])
    expect((config as any).mac.target).toEqual(['dmg'])
    // `deb` needs author email + homepage, so AppImage is the only target that
    // works without extra metadata.
    expect((config as any).linux.target).toEqual(['AppImage'])
    expect((config as any).nsis).toMatchObject({ oneClick: false, allowToChangeInstallationDirectory: true })
    expect((config as any).files).toEqual(['electron/**/*', 'web/**/*', 'resources/**/*', 'package.json'])
    expect(config.publish).toBeUndefined()
  })

  it('uses the updater feed as publish config and passes through options', () => {
    const config = createElectronBuilderConfig(resolve({
      updater: { provider: 'github', autoDownload: false },
      pack: {
        output: 'release-out',
        targets: { win: ['zip'] },
        nsis: { oneClick: true },
        dmg: { title: 'Installer' },
        linux: { category: 'Development' },
      },
    }), projectRoot, electronVersion)

    expect(config.publish).toEqual({ provider: 'github' })
    expect((config as any).directories.output).toBe(join(projectRoot, 'release-out'))
    expect((config as any).win.target).toEqual(['zip'])
    expect((config as any).nsis).toMatchObject({ oneClick: true, allowToChangeInstallationDirectory: true })
    expect((config as any).dmg).toEqual({ title: 'Installer' })
    expect((config as any).linux.category).toBe('Development')
  })

  it('prefers explicit publish config and emits the icon when set', () => {
    const config = createElectronBuilderConfig(resolve({
      app: { icon: 'static/logo.png' },
      pack: { publish: { provider: 'generic', url: 'https://example.com/updates' } },
    }), projectRoot, electronVersion)

    expect(config.publish).toEqual({ provider: 'generic', url: 'https://example.com/updates' })
    expect((config as any).win.icon).toBe('resources/icon.png')
    expect((config as any).mac.icon).toBe('resources/icon.png')
  })

  it('keeps the icon file extension so a jpg icon still resolves', () => {
    const config = createElectronBuilderConfig(resolve({
      app: { icon: 'static/logo.jpg' },
    }), projectRoot, electronVersion)

    expect((config as any).win.icon).toBe('resources/icon.jpg')
  })
})
