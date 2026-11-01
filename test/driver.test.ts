import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopConfig } from '../src/config/resolve'
import { assembleDesktopApp, startDesktopDevRuntime } from '../src/vite/driver'

const tempDirs: string[] = []
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

vi.mock('../src/orchestrate/pack', () => ({
  packInternal: vi.fn(async () => {}),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

async function createProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-driver-'))
  tempDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, content)
  }
  await mkdir(join(dir, 'node_modules/@uni-helper'), { recursive: true })
  await symlink(packageRoot, join(dir, 'node_modules/@uni-helper/desktop'), 'dir')
  return dir
}

async function projectWithWeb(): Promise<{ root: string, webDir: string, resolved: any }> {
  const root = await createProject({
    'package.json': JSON.stringify({
      'name': 'driver-test',
      'version': '1.0.0',
      'author': 'Example <dev@example.com>',
      'homepage': 'https://example.com',
      'description': 'Driver test app',
      'uni-app': {
        scripts: {
          desktop: { env: { UNI_PLATFORM: 'h5' }, define: { DESKTOP: true, H5: false, WEB: false } },
        },
      },
    }),
    'src/manifest.json': JSON.stringify({
      name: 'driver-test-app',
      versionName: '2.0.0',
      h5: { title: 'Driver Test', router: { mode: 'hash', base: './' } },
    }),
    'web/index.html': '<html>desktop build</html>',
    'web/assets/app.js': 'console.log("app")',
  })
  const { resolved } = await resolveDesktopConfig(root)
  // Point the assembled dir at this temp root (resolveDesktopConfig roots at cwd).
  resolved.root = root
  resolved.pack.autoPack = false
  return { root, webDir: join(root, 'web'), resolved }
}

describe('assembleDesktopApp', () => {
  it('assembles a self-contained app dir with relative asset references', async () => {
    const { root, webDir, resolved } = await projectWithWeb()

    const outDir = await assembleDesktopApp(resolved, webDir)

    expect(outDir).toBe(join(root, 'dist/desktop'))
    const main = await readFile(join(outDir, 'electron/main.cjs'), 'utf8')
    // The baked config must not leak build-machine paths, otherwise the tray
    // and window icons vanish once electron-builder moves the app.
    expect(main).not.toContain(root)
    expect(main).toContain('icon.png')
    expect(main).toContain('desktop:uni:saveFile')
    expect(main).toContain('requestSingleInstanceLock')
    expect(main).toContain('setWindowOpenHandler')
    expect(main).not.toContain('installDesktopShim')

    const pkg = JSON.parse(await readFile(join(outDir, 'package.json'), 'utf8'))
    expect(pkg).toMatchObject({
      productName: 'driver-test-app',
      version: '2.0.0',
      main: 'electron/main.cjs',
      author: 'Example <dev@example.com>',
    })

    expect(await readFile(join(outDir, 'web/index.html'), 'utf8')).toContain('desktop build')
    expect(existsSync(join(outDir, 'web/assets/app.js'))).toBe(true)
    expect(existsSync(join(outDir, 'resources/icon.png'))).toBe(true)
    expect(vi.mocked(await import('../src/orchestrate/pack')).packInternal).not.toHaveBeenCalled()
  })

  it('keeps the web bundle in place when the build already wrote into the app dir', async () => {
    const { root, resolved } = await projectWithWeb()
    const webDir = join(root, 'dist/desktop/web')
    const outDirSource = join(root, 'web')
    await mkdir(join(root, 'dist/desktop'), { recursive: true })
    await rm(outDirSource, { recursive: true, force: true })
    await mkdir(webDir, { recursive: true })
    await writeFile(join(webDir, 'index.html'), '<html>in place</html>')

    await assembleDesktopApp(resolved, webDir)

    // The pre-existing web bundle survives the shell assembly.
    expect(await readFile(join(webDir, 'index.html'), 'utf8')).toContain('in place')
    expect(existsSync(join(root, 'dist/desktop/electron/main.cjs'))).toBe(true)
  })

  it('runs electron-builder when pack.autoPack is enabled', async () => {
    const { root, webDir, resolved } = await projectWithWeb()
    resolved.pack.autoPack = true

    await assembleDesktopApp(resolved, webDir)

    const { packInternal } = await import('../src/orchestrate/pack')
    expect(packInternal).toHaveBeenCalledWith(root, resolved, join(root, 'dist/desktop'))
  })

  it('fails with a clear error when the uni build output is missing', async () => {
    const { root, resolved } = await projectWithWeb()

    await expect(assembleDesktopApp(resolved, join(root, 'web/nowhere')))
      .rejects
      .toThrow('H5 build output not found')
  })
})

describe('startDesktopDevRuntime', () => {
  it('fails with a readable error when electron is not installed', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({ name: 'no-electron', version: '1.0.0' }),
      'src/manifest.json': JSON.stringify({ name: 'no-electron-app' }),
    })
    const { resolved } = await resolveDesktopConfig(root)
    resolved.root = root

    await expect(startDesktopDevRuntime(resolved, 'http://localhost:5173'))
      .rejects
      .toThrow('electron')
  })
})
