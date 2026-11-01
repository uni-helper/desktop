import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { logger } from '../src/log'
import { ensureDesktopProject } from '../src/vite/setup'

const tempDirs: string[] = []
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function createProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-setup-'))
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

function baseProject(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'package.json': JSON.stringify({
      'name': 'setup-test',
      'version': '1.0.0',
      'scripts': {},
      'uni-app': {
        scripts: {
          desktop: {
            title: 'Desktop',
            env: { UNI_PLATFORM: 'h5' },
            define: { DESKTOP: true, H5: false, WEB: false },
          },
        },
      },
    }),
    ...extra,
  }
}

describe('ensureDesktopProject', () => {
  it('normalizes h5.router while keeping conditional compilation', async () => {
    const root = await createProject(baseProject({
      'src/manifest.json': `{
  "name": "setup-app",
  "h5": { "router": { "mode": "history" } },
  // #ifdef MP-WEIXIN
  "mp-weixin": { "appid": "wx123" }
  // #endif
}
`,
    }))

    await ensureDesktopProject(root, { interactive: false })

    const manifest = await readFile(join(root, 'src/manifest.json'), 'utf8')
    expect(manifest).toContain('"mode": "hash"')
    expect(manifest).toContain('"base": "./"')
    expect(manifest).toContain('// #ifdef MP-WEIXIN')
    expect(manifest).toContain('"appid": "wx123"')
    expect(manifest).not.toContain('"mode": "history"')
  })

  it('creates unh.config.ts and the desktop npm scripts', async () => {
    const root = await createProject(baseProject({
      'src/manifest.json': JSON.stringify({ name: 'setup-app' }),
    }))

    await ensureDesktopProject(root, { interactive: false })

    const config = await readFile(join(root, 'unh.config.ts'), 'utf8')
    expect(config).toContain('import { defineConfig } from \'@uni-helper/desktop\'')
    expect(config).toContain('name: \'setup-app\'')

    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['dev:desktop']).toBe('uni -p desktop')
    expect(pkg.scripts['build:desktop']).toBe('uni build -p desktop')
  })

  it('rejects a desktop entry whose base platform is not h5', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({
        'name': 'setup-test',
        'uni-app': {
          scripts: {
            desktop: { env: { UNI_PLATFORM: 'mp-weixin' }, define: { DESKTOP: true } },
          },
        },
      }),
    })

    await expect(ensureDesktopProject(root, { interactive: false }))
      .rejects
      .toThrow('UNI_PLATFORM')
  })

  it('warns when the desktop define lacks the H5/WEB off keys', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({
        'name': 'setup-test',
        'uni-app': {
          scripts: {
            desktop: { env: { UNI_PLATFORM: 'h5' }, define: { DESKTOP: true } },
          },
        },
      }),
    })
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    // Assertions must run before mockRestore: restoring clears call history.
    await ensureDesktopProject(root, { interactive: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"H5": false'))
    warn.mockRestore()
  })

  it('warns about missing electron dependencies without installing', async () => {
    const root = await createProject(baseProject())
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await ensureDesktopProject(root, { interactive: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('electron'))
    warn.mockRestore()
    expect(existsSync(join(root, 'node_modules/electron'))).toBe(false)
  })

  it('stays quiet once a root has been checked', async () => {
    const root = await createProject(baseProject({
      'src/manifest.json': JSON.stringify({ name: 'setup-app', h5: { router: { mode: 'history' } } }),
    }))
    await ensureDesktopProject(root, { interactive: false })

    // A second call (e.g. a vite server restart) must not rewrite files again.
    const manifest = await readFile(join(root, 'src/manifest.json'), 'utf8')
    await ensureDesktopProject(root, { interactive: false })
    expect(await readFile(join(root, 'src/manifest.json'), 'utf8')).toBe(manifest)
  })

  it('keeps an already-correct project untouched', async () => {
    const manifest = `{
  // The app name
  "name": "setup-app",
  "h5": { "router": { "mode": "hash", "base": "./" } }
}
`
    const root = await createProject(baseProject({
      'src/manifest.json': manifest,
      'src/main.ts': 'export function createApp() {}\n',
      'unh.config.ts': 'export default {}\n',
    }))

    await ensureDesktopProject(root, { interactive: false })

    expect(await readFile(join(root, 'src/manifest.json'), 'utf8')).toBe(manifest)
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['dev:desktop']).toBe('uni -p desktop')
  })

  it('leaves no temp files behind after rewriting', async () => {
    const root = await createProject(baseProject({
      'src/manifest.json': JSON.stringify({ name: 'setup-app', h5: { router: { mode: 'history' } } }),
    }))

    await ensureDesktopProject(root, { interactive: false })

    const entries = await readdir(root)
    expect(entries.filter(name => name.includes('uni-desktop-tmp'))).toEqual([])
  })
})
