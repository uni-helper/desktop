import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config/resolve'
import { build } from '../src/orchestrate/build'
import { createElectronBuilderConfig } from '../src/orchestrate/pack'

const tempDirs: string[] = []

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * A minimal uni-app-like project: `build:h5` just writes the index.html that
 * `build()` expects into `UNI_OUTPUT_DIR`, so the test exercises the real
 * orchestration without the uni-app toolchain.
 */
async function createProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-build-'))
  tempDirs.push(dir)
  const defaults = {
    'package.json': JSON.stringify({
      name: 'build-test',
      version: '1.0.0',
      scripts: { 'build:h5': 'node build-h5.mjs' },
      author: 'Example <dev@example.com>',
      homepage: 'https://example.com',
      description: 'Build test app',
    }),
    'build-h5.mjs': `import { mkdirSync, writeFileSync } from 'node:fs'\nconst out = process.env.UNI_OUTPUT_DIR\nmkdirSync(out, { recursive: true })\nwriteFileSync(out + '/index.html', '<html></html>')\n`,
    'src/manifest.json': JSON.stringify({
      name: 'build-test-app',
      versionName: '2.0.0',
      h5: { title: 'Build Test', router: { mode: 'hash', base: './' } },
    }),
  }
  for (const [name, content] of Object.entries({ ...defaults, ...files })) {
    const file = join(dir, name)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, content)
  }
  return dir
}

describe('build', () => {
  it('assembles a self-contained app dir with relative asset references', async () => {
    const root = await createProject({
      'unh.config.json': JSON.stringify({
        desktop: {
          app: { icon: 'static/logo.png' },
          tray: { tooltip: 'Tray' },
        },
      }),
      'static/logo.png': 'png',
    })

    const result = await build({ cwd: root, pack: false })

    const main = await readFile(join(result.outDir, 'electron/main.cjs'), 'utf8')
    // The baked config must not leak build-machine paths, otherwise the tray and
    // window icons vanish once electron-builder moves the app.
    expect(main).not.toContain(root)
    expect(main).toContain('icon.png')
    expect(main).toContain('tray-icon.png')

    // The renderer-side shim installer must stay out of the main process.
    expect(main).not.toContain('installDesktopShim')
    expect(main).toContain('desktop:uni:saveFile')
    expect(main).toContain('requestSingleInstanceLock')
    expect(main).toContain('setWindowOpenHandler')

    const pkg = JSON.parse(await readFile(join(result.outDir, 'package.json'), 'utf8'))
    expect(pkg).toMatchObject({
      productName: 'build-test-app',
      version: '2.0.0',
      main: 'electron/main.cjs',
      author: 'Example <dev@example.com>',
      homepage: 'https://example.com',
      description: 'Build test app',
    })
  })

  it('copies icons next to the assembled app so the runtime can find them', async () => {
    const root = await createProject({
      'unh.config.json': JSON.stringify({ desktop: { app: { icon: 'static/logo.png' } } }),
      'static/logo.png': 'png',
    })

    const result = await build({ cwd: root, pack: false })

    expect(existsSync(join(result.outDir, 'resources/icon.png'))).toBe(true)
    // The runtime resolves `__dirname/../resources`, i.e. next to `electron/`.
    expect(existsSync(join(result.outDir, 'electron/../resources/icon.png'))).toBe(true)
  })

  it('uses the built-in uni-helper icon when the config sets none', async () => {
    const root = await createProject({})

    const result = await build({ cwd: root, pack: false })

    // Without a configured icon the assembled app still gets one, so the Dock,
    // window and installers never fall back to Electron's icon.
    const icon = await readFile(join(result.outDir, 'resources/icon.png'))
    expect(icon.byteLength).toBeGreaterThan(0)
    const main = await readFile(join(result.outDir, 'electron/main.cjs'), 'utf8')
    expect(main).toContain('app.dock')
  })

  it('generates an electron-builder config that pins the electron version', () => {
    const resolved = normalizeConfig({}, { name: 'app' }, '/tmp/app')
    const config = createElectronBuilderConfig(resolved, '/tmp/app', '45.0.0')

    // Without this electron-builder resolves `projectDir` to the app dir, finds
    // no `node_modules/electron`, and aborts with "Cannot compute electron
    // version".
    expect(config.electronVersion).toBe('45.0.0')
  })
})
