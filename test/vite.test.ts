import type { Plugin } from 'vite'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDesktopBuild } from '../src/vite/driver'
import { uniDesktop } from '../src/vite/index'

const UNI_H5_ID = '@dcloudio/uni-h5'

const resolved = {
  root: '/project',
  appName: 'app',
  appId: 'desktop.uniapp.app',
  version: '1.0.0',
  icon: '/project/icon.png',
  window: {},
  dev: { url: 'http://localhost:5173', openDevtools: false },
  tray: false,
  updater: false,
  pack: { autoPack: false, output: 'dist/release', asar: true, targets: {} },
} as any

const mocks = vi.hoisted(() => ({
  ensureDesktopProject: vi.fn(),
  ensureDesktopUniScript: vi.fn(),
  startDesktopDevRuntime: vi.fn(),
  assembleDesktopApp: vi.fn(),
}))

vi.mock('../src/vite/setup', () => ({
  ensureDesktopProject: mocks.ensureDesktopProject,
  ensureDesktopUniScript: mocks.ensureDesktopUniScript,
}))

vi.mock('../src/vite/driver', async importOriginal => ({
  ...await importOriginal<typeof import('../src/vite/driver')>(),
  startDesktopDevRuntime: mocks.startDesktopDevRuntime,
  assembleDesktopApp: mocks.assembleDesktopApp,
}))

const ensureDesktopProject = mocks.ensureDesktopProject.mockResolvedValue({
  resolved,
  manifest: undefined,
  userConfig: undefined,
  warnings: [],
})
const startDesktopDevRuntime = mocks.startDesktopDevRuntime.mockResolvedValue({ close: vi.fn(async () => {}) })
const assembleDesktopApp = mocks.assembleDesktopApp.mockResolvedValue('/project/dist/build/desktop')

function plugin(): Plugin {
  return uniDesktop()
}

/** Vite wraps hooks in `{ handler, order }` objects; get the callable. */
function hook<T extends (this: any, ...args: any[]) => any>(value: T | { handler: T }): T {
  return typeof value === 'function' ? value : value.handler
}

function resolveId(instance: Plugin, context: unknown, ...args: any[]): any {
  return (hook(instance.resolveId!) as (...a: any[]) => any).call(context, ...args)
}

function load(instance: Plugin, id: string): any {
  return (hook(instance.load!) as (...a: any[]) => any).call({} as any, id)
}

// Test double for vite's resolved config.
function fakeViteConfig(root = '/project', command: 'serve' | 'build' = 'build'): any {
  return { root, command, build: { outDir: 'dist/build/h5' } }
}

/** A fake dev server whose httpServer reports a bound localhost address. */
function fakeServer(): any {
  const httpServer: any = new EventEmitter()
  httpServer.address = () => ({ address: '127.0.0.1', port: 5173 })
  return { httpServer, config: { server: {} } }
}

const ENV_KEYS = ['UNI_CUSTOM_CONTEXT', 'UNI_PLATFORM', 'DESKTOP_DEV_URL'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  vi.clearAllMocks()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined)
      delete process.env[key]
    else
      process.env[key] = savedEnv[key]
  }
})

describe('uniDesktop vite plugin', () => {
  it('keeps its own shim modules out of vite dep pre-bundling', () => {
    const instance = plugin()

    // A workspace-linked SDK rebuild does not change the optimizeDeps hash,
    // so a pre-bundled shim entry would keep missing new exports until the
    // cache is deleted. Excluded ESM deps are served as source instead.
    const config = hook(instance.config!).call({} as any, {} as any, {} as any)

    expect(config).toEqual({
      optimizeDeps: { exclude: ['@uni-helper/desktop/shim', '@uni-helper/desktop/shim/apis'] },
    })
  })

  it('orders its resolver ahead of uni\'s own pre-group resolver', () => {
    const instance = plugin()

    // uni resolves `@dcloudio/uni-h5` to an absolute path in its own pre-group
    // resolveId; only a hook-level `order: 'pre'` runs ahead of it regardless
    // of the plugin's position in the user's `plugins` array.
    expect(instance.resolveId).toMatchObject({ order: 'pre' })
  })

  it('redirects uni-h5 imports to the desktop wrapper', async () => {
    const instance = plugin()

    const resolvedId = await resolveId(instance, {}, UNI_H5_ID, '/project/src/main.ts', {})

    expect(resolvedId).toBe('\0uni-desktop/uni-h5')
  })

  it('resolves the real uni-h5 module for the wrapper itself', async () => {
    const instance = plugin()
    const resolve = vi.fn(async () => ({ id: '/real/uni-h5.es.js' }))

    const resolvedId = await resolveId(instance, { resolve }, UNI_H5_ID, '\0uni-desktop/uni-h5', {})

    // Without skipSelf the wrapper would import itself and loop forever.
    expect(resolve).toHaveBeenCalledWith(UNI_H5_ID, '\0uni-desktop/uni-h5', expect.objectContaining({ skipSelf: true }))
    expect(resolvedId.id).toBe('/real/uni-h5.es.js')
  })

  it('leaves every other module alone', async () => {
    const instance = plugin()

    expect(await resolveId(instance, {}, '@dcloudio/uni-h5/style.css', '/src/main.ts', {})).toBeUndefined()
    expect(await resolveId(instance, {}, 'vue', '/src/main.ts', {})).toBeUndefined()
  })

  it('generates a wrapper that keeps uni-h5 exports, overrides the desktop APIs and installs the shim', () => {
    const instance = plugin()

    const loaded = load(instance, '\0uni-desktop/uni-h5')

    expect(loaded).toBeTruthy()
    const code = typeof loaded === 'string' ? loaded : loaded.code
    expect(code).toContain(`export * from '${UNI_H5_ID}'`)
    expect(code).toContain('\'@uni-helper/desktop/shim/apis\'')
    expect(code).toContain('createOpenDocument')
    // The desktop implementations replace uni-h5's own exports. The saved-file
    // names are derived from the shim channel list.
    expect(code).toContain('export const openDocument = createOpenDocument(openDocumentH5)')
    expect(code).toContain('export { saveFile, getSavedFileList, getSavedFileInfo, removeSavedFile, getUpdateManager } from \'@uni-helper/desktop/shim/apis\'')
    // The wrapper installs the runtime shim itself: it evaluates before uni
    // assigns the global `uni` in both dev and tree-shaken builds.
    expect(code).toContain('installDesktopShim()')
  })

  it('does not load other modules', () => {
    const instance = plugin()

    expect(load(instance, '/src/main.ts')).toBeUndefined()
  })
})

describe('isDesktopBuild', () => {
  it('reads DESKTOP from uni\'s custom context', () => {
    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ DESKTOP: true })
    expect(isDesktopBuild()).toBe(true)

    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ DESKTOP: false })
    expect(isDesktopBuild()).toBe(false)

    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ MP_WEIXIN: true })
    expect(isDesktopBuild()).toBe(false)

    process.env.UNI_CUSTOM_CONTEXT = ''
    expect(isDesktopBuild()).toBe(false)
  })

  it('normalizes keys like uni does', () => {
    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ desktop: true })
    expect(isDesktopBuild()).toBe(true)
  })

  it('fails loudly on malformed json instead of silently skipping the build', () => {
    process.env.UNI_CUSTOM_CONTEXT = 'not json'
    expect(() => isDesktopBuild()).toThrow()
  })
})

describe('desktop platform detection in configResolved', () => {
  it('creates the missing uni-app.scripts entry and asks for a re-run', () => {
    const instance = plugin()
    process.env.UNI_PLATFORM = 'desktop'

    expect(() => hook(instance.configResolved!).call({} as any, fakeViteConfig()))
      .toThrow('Re-run the command to apply it')
    expect(mocks.ensureDesktopUniScript).toHaveBeenCalledWith('/project')
  })

  it('accepts a resolved desktop platform build', () => {
    const instance = plugin()
    process.env.UNI_PLATFORM = 'h5'
    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ DESKTOP: true })

    expect(() => hook(instance.configResolved!).call({} as any, fakeViteConfig())).not.toThrow()
  })

  it('ignores non-desktop builds entirely', () => {
    const instance = plugin()
    process.env.UNI_PLATFORM = 'h5'

    expect(() => hook(instance.configResolved!).call({} as any, fakeViteConfig())).not.toThrow()
  })
})

describe('desktop dev: configureServer drives the shell', () => {
  it('checks the project and starts the shell when the server listens', async () => {
    const instance = plugin()
    process.env.UNI_PLATFORM = 'h5'
    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ DESKTOP: true })
    hook(instance.configResolved!).call({} as any, fakeViteConfig())

    const server = fakeServer()
    const postHook = await hook(instance.configureServer!).call({} as any, server)
    expect(ensureDesktopProject).toHaveBeenCalledWith('/project')

    expect(typeof postHook).toBe('function')
    postHook!()
    server.httpServer.emit('listening')
    await vi.waitFor(() => {
      expect(startDesktopDevRuntime).toHaveBeenCalledWith(resolved, 'http://localhost:5173')
    })
  })

  it('stops the shell when the dev server closes', async () => {
    const instance = plugin()
    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ DESKTOP: true })
    hook(instance.configResolved!).call({} as any, fakeViteConfig())

    const server = fakeServer()
    const postHook = await hook(instance.configureServer!).call({} as any, server)
    postHook!()
    server.httpServer.emit('listening')
    await vi.waitFor(() => expect(startDesktopDevRuntime).toHaveBeenCalled())
    const runtime = await startDesktopDevRuntime.mock.results[0]!.value

    server.httpServer.emit('close')
    await vi.waitFor(() => expect(runtime.close).toHaveBeenCalled())
  })

  it('does nothing for non-desktop builds', async () => {
    const instance = plugin()
    process.env.UNI_PLATFORM = 'h5'
    hook(instance.configResolved!).call({} as any, fakeViteConfig())

    const postHook = await hook(instance.configureServer!).call({} as any, fakeServer())

    expect(ensureDesktopProject).not.toHaveBeenCalled()
    expect(postHook).toBeUndefined()
  })
})

describe('desktop build: buildStart checks, closeBundle assembles', () => {
  it('checks the project and assembles the app after the build', async () => {
    const instance = plugin()
    process.env.UNI_PLATFORM = 'h5'
    process.env.UNI_CUSTOM_CONTEXT = JSON.stringify({ DESKTOP: true })
    hook(instance.configResolved!).call({} as any, fakeViteConfig())

    await hook(instance.buildStart!).call({} as any, {} as any)
    expect(ensureDesktopProject).toHaveBeenCalledWith('/project')

    await hook(instance.closeBundle!).call({} as any)
    expect(assembleDesktopApp).toHaveBeenCalledWith(resolved, '/project/dist/build/h5')
  })

  it('does nothing for non-desktop builds', async () => {
    const instance = plugin()
    process.env.UNI_PLATFORM = 'h5'
    hook(instance.configResolved!).call({} as any, fakeViteConfig())

    await hook(instance.buildStart!).call({} as any, {} as any)
    await hook(instance.closeBundle!).call({} as any)

    expect(ensureDesktopProject).not.toHaveBeenCalled()
    expect(assembleDesktopApp).not.toHaveBeenCalled()
  })
})
