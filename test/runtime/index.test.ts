import type { BakedDesktopConfig } from '../../src/baked'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, ...args: any[]) => unknown>(),
  protocolHandlers: new Map<string, (request: Request) => Promise<Response>>(),
  windowOptions: undefined as Record<string, any> | undefined,
  window: undefined as any,
  openExternalUrls: [] as string[],
  quit: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  registerSchemes: vi.fn(),
}))

let userDataPath = ''
const tempDirs: string[] = []

vi.mock('electron', async () => {
  // The factory is hoisted above the imports, so `EventEmitter` must be pulled
  // in here instead of referencing the module-level import.
  const { EventEmitter } = await import('node:events')
  class FakeWebContents extends EventEmitter {
    setWindowOpenHandler = vi.fn()
    openDevTools = vi.fn()
  }
  class FakeBrowserWindow extends EventEmitter {
    webContents = new FakeWebContents()
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
    focus = vi.fn()
    show = vi.fn()
    restore = vi.fn()
    isMinimized = vi.fn(() => false)
    constructor(options: Record<string, any>) {
      super()
      state.windowOptions = options
      state.window = this
    }
  }
  return {
    app: {
      getPath: vi.fn(() => userDataPath),
      setName: vi.fn(),
      requestSingleInstanceLock: state.requestSingleInstanceLock,
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: state.quit,
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: { handle: (channel: string, handler: any) => state.ipcHandlers.set(channel, handler) },
    protocol: {
      registerSchemesAsPrivileged: state.registerSchemes,
      handle: (scheme: string, handler: any) => state.protocolHandlers.set(scheme, handler),
    },
    shell: {
      openExternal: vi.fn(async (url: string) => { state.openExternalUrls.push(url) }),
      openPath: vi.fn(async () => ''),
    },
    Menu: { buildFromTemplate: vi.fn((t: any) => t) },
    Tray: class { setContextMenu = vi.fn(); setToolTip = vi.fn(); on = vi.fn() },
  }
})

let runtime: typeof import('../../src/runtime/index')

beforeEach(async () => {
  vi.resetModules()
  // Disconnect listeners live on the real process and would pile up across
  // tests (the runtime registers one per boot); keep the count per-test exact.
  process.removeAllListeners('disconnect')
  state.ipcHandlers.clear()
  state.protocolHandlers.clear()
  state.windowOptions = undefined
  state.window = undefined
  state.openExternalUrls = []
  state.quit.mockClear()
  state.registerSchemes.mockClear()
  state.requestSingleInstanceLock.mockReturnValue(true)
  userDataPath = await mkdtemp(join(tmpdir(), 'uni-desktop-runtime-'))
  tempDirs.push(userDataPath)
  runtime = await import('../../src/runtime/index')
})

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

function bakedFixture(): BakedDesktopConfig {
  return {
    appName: 'runtime-test-app',
    window: {
      title: 'Runtime Test',
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
    icon: 'icon.png',
  }
}

function savedRoot(): string {
  return join(userDataPath, 'uni-desktop-files')
}

/** Boot the app and wait for the whenReady work (protocol + window) to land. */
async function boot(): Promise<void> {
  runtime.createDesktopApp(bakedFixture())
  await vi.waitFor(() => expect(state.protocolHandlers.has('desktop-file')).toBe(true))
}

describe('saved-file ipc handlers', () => {
  it('saveFile writes bytes into the managed directory', async () => {
    await boot()
    const handler = state.ipcHandlers.get('desktop:uni:saveFile')!

    const result = await handler({}, { bytes: new TextEncoder().encode('png-bytes'), mime: 'image/png' }) as { savedFilePath: string }

    expect(result.savedFilePath.startsWith('desktop-file://f/')).toBe(true)
    const names = (await readdir(savedRoot())).filter(name => name.endsWith('.png'))
    expect(names).toHaveLength(1)
    const savedPath = runtime.parseDesktopFileUrl(result.savedFilePath)
    expect(savedPath.startsWith(savedRoot())).toBe(true)
    expect(await readFile(savedPath, 'utf8')).toBe('png-bytes')
  })

  it('saveFile rejects non-bytes payloads', async () => {
    await boot()
    const handler = state.ipcHandlers.get('desktop:uni:saveFile')!

    await expect(handler({}, { bytes: 'nope' })).rejects.toThrow()
    await expect(handler({}, null)).rejects.toThrow()
  })

  it('saveFile derives docx from the OOXML mime', async () => {
    await boot()
    const handler = state.ipcHandlers.get('desktop:uni:saveFile')!

    const result = await handler({}, {
      bytes: new TextEncoder().encode('docx-bytes'),
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }) as { savedFilePath: string }

    const savedPath = runtime.parseDesktopFileUrl(result.savedFilePath)
    expect(savedPath.endsWith('.docx')).toBe(true)
  })

  it('saveFile prefers an explicit fileName extension', async () => {
    await boot()
    const handler = state.ipcHandlers.get('desktop:uni:saveFile')!

    const named = await handler({}, {
      bytes: new TextEncoder().encode('docx-bytes'),
      mime: 'application/octet-stream',
      fileName: '报告最终版.docx',
    }) as { savedFilePath: string }
    expect(runtime.parseDesktopFileUrl(named.savedFilePath).endsWith('.docx')).toBe(true)

    const nameless = await handler({}, {
      bytes: new TextEncoder().encode('raw-bytes'),
      fileName: 'noext',
    }) as { savedFilePath: string }
    const savedPath = runtime.parseDesktopFileUrl(nameless.savedFilePath)
    expect(extname(savedPath)).toBe('')
  })

  it('getSavedFileInfo and removeSavedFile reject paths outside the managed directory', async () => {
    await boot()
    const outsidePath = join(userDataPath, 'outside.txt')
    await writeFile(outsidePath, 'x')

    const infoHandler = state.ipcHandlers.get('desktop:uni:getSavedFileInfo')!
    const removeHandler = state.ipcHandlers.get('desktop:uni:removeSavedFile')!
    await expect(infoHandler({}, { filePath: outsidePath })).rejects.toThrow('outside the managed directories')
    await expect(removeHandler({}, { filePath: outsidePath })).rejects.toThrow('outside the managed directories')
  })

  it('removeSavedFile rejects traversal via a desktop-file url', async () => {
    await boot()
    const handler = state.ipcHandlers.get('desktop:uni:removeSavedFile')!

    await expect(handler({}, { filePath: `desktop-file://f/${encodeURIComponent('../../etc')}` }))
      .rejects
      .toThrow()
  })

  it('removeSavedFile rejects a symlink escaping the root', async () => {
    await boot()
    const outsidePath = join(userDataPath, 'outside.txt')
    await writeFile(outsidePath, 'x')
    await mkdir(savedRoot(), { recursive: true })
    await symlink(outsidePath, join(savedRoot(), 'link.txt'))

    const handler = state.ipcHandlers.get('desktop:uni:removeSavedFile')!
    await expect(handler({}, { filePath: join(savedRoot(), 'link.txt') })).rejects.toThrow('outside the managed directories')
  })

  it('openDocument opens a contained file', async () => {
    await boot()
    const electron = await import('electron')
    await mkdir(savedRoot(), { recursive: true })
    const docPath = join(savedRoot(), 'doc.txt')
    await writeFile(docPath, 'doc')
    const handler = state.ipcHandlers.get('desktop:uni:openDocument')!

    vi.mocked(electron.shell.openPath).mockResolvedValueOnce('')
    await expect(handler({}, { filePath: docPath })).resolves.toEqual({})

    vi.mocked(electron.shell.openPath).mockResolvedValueOnce('access denied')
    await expect(handler({}, { filePath: docPath })).rejects.toThrow('access denied')
  })

  it('handlers reject non-object payloads', async () => {
    await boot()
    const handler = state.ipcHandlers.get('desktop:uni:getSavedFileInfo')!

    await expect(handler({}, 'str')).rejects.toThrow()
    await expect(handler({}, [1])).rejects.toThrow()
  })
})

describe('desktop-file protocol', () => {
  it('serves a file inside the root with its content type', async () => {
    await boot()
    await mkdir(savedRoot(), { recursive: true })
    const filePath = join(savedRoot(), 'pic.png')
    const content = new TextEncoder().encode('png-bytes')
    await writeFile(filePath, content)
    const handler = state.protocolHandlers.get('desktop-file')!

    const response = await handler(new Request(runtime.toDesktopFileUrl(filePath)))

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('404 for a missing file', async () => {
    await boot()
    const handler = state.protocolHandlers.get('desktop-file')!

    const response = await handler(new Request(runtime.toDesktopFileUrl(join(savedRoot(), 'missing.png'))))

    expect(response.status).toBe(404)
  })

  it('403 for a file outside the root', async () => {
    await boot()
    await mkdir(savedRoot(), { recursive: true })
    const outsidePath = join(userDataPath, 'outside.png')
    await writeFile(outsidePath, 'x')
    const handler = state.protocolHandlers.get('desktop-file')!

    const response = await handler(new Request(runtime.toDesktopFileUrl(outsidePath)))

    expect(response.status).toBe(403)
  })

  it('404 for a malformed url', async () => {
    await boot()
    const handler = state.protocolHandlers.get('desktop-file')!

    // The runtime only reads `request.url`, so a plain object stands in for a
    // Request when the scheme cannot be constructed in this environment.
    const response = await handler({ url: 'desktop-file://f/' } as Request)

    expect(response.status).toBe(404)
  })
})

describe('navigation hardening', () => {
  function navigate(url: string): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    state.window.webContents.emit('will-navigate', event, url)
    return event
  }

  it('packaged mode blocks file navigation outside the app web dir', async () => {
    await boot()

    const event = navigate('file:///etc/index.html')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(state.openExternalUrls).toEqual([])
  })

  it('packaged mode navigates within the app web dir', async () => {
    await boot()

    // The containment check compares parsed paths only, so the target file
    // does not need to exist.
    const webDir = join(fileURLToPath(new URL('../../src', import.meta.url)), 'web')
    const event = navigate(pathToFileURL(join(webDir, 'index.html')).href)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('prefix lookalikes are blocked', async () => {
    vi.stubEnv('DESKTOP_DEV_URL', 'http://localhost:5173')
    await boot()

    const evilHost = navigate('http://localhost:5173.evil.com/')
    const evilUserInfo = navigate('http://localhost:5173@evil.com/')

    expect(evilHost.preventDefault).toHaveBeenCalled()
    expect(evilUserInfo.preventDefault).toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('openExternal only receives web schemes', async () => {
    vi.stubEnv('DESKTOP_DEV_URL', 'http://localhost:5173')
    await boot()

    const onOpen = state.window.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string }
    const result = onOpen({ url: 'file:///etc/passwd' })

    expect(result).toEqual({ action: 'deny' })
    expect(state.openExternalUrls).toEqual([])
    vi.unstubAllEnvs()
  })

  it('dev mode navigates within the dev url', async () => {
    vi.stubEnv('DESKTOP_DEV_URL', 'http://localhost:5173')
    await boot()

    const event = navigate('http://localhost:5173/page')

    expect(event.preventDefault).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('dev mode blocks and opens other urls', async () => {
    vi.stubEnv('DESKTOP_DEV_URL', 'http://localhost:5173')
    await boot()

    const event = navigate('https://example.com')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(state.openExternalUrls).toContain('https://example.com')
    vi.unstubAllEnvs()
  })

  it('window open handler denies external urls', async () => {
    vi.stubEnv('DESKTOP_DEV_URL', 'http://localhost:5173')
    await boot()

    const onOpen = state.window.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string }
    const result = onOpen({ url: 'https://example.com' })

    expect(result).toEqual({ action: 'deny' })
    expect(state.openExternalUrls).toContain('https://example.com')
    vi.unstubAllEnvs()
  })

  it('creates the window with the safe webPreferences and packaged web entry', async () => {
    await boot()

    // vite-node gives the module a real `__dirname` (its own source directory),
    // so the pins anchor on that directory instead of a packaged-app path: the
    // layout contract is `preload` next to the main bundle and `web/` one level up.
    const runtimeDir = fileURLToPath(new URL('../../src/runtime', import.meta.url))
    expect(state.windowOptions!.webPreferences).toEqual({
      preload: join(runtimeDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    })
    expect(state.window.loadFile).toHaveBeenCalledWith(join(runtimeDir, '..', 'web', 'index.html'))
  })
})

describe('app lifecycle', () => {
  it('quits when another instance holds the lock', async () => {
    state.requestSingleInstanceLock.mockReturnValue(false)

    runtime.createDesktopApp(bakedFixture())

    expect(state.quit).toHaveBeenCalled()
    expect(state.windowOptions).toBeUndefined()
  })

  it('registers the privileged scheme before ready', async () => {
    await boot()

    expect(state.registerSchemes).toHaveBeenCalledWith([
      { scheme: 'desktop-file', privileges: { secure: true, supportFetchAPI: true, stream: true } },
    ])
  })

  it('quits when the dev ipc channel disconnects', async () => {
    boot()
    await vi.waitFor(() => expect(state.protocolHandlers.has('desktop-file')).toBe(true))

    process.emit('disconnect')
    process.emit('disconnect')

    // Electron ignores repeat quits, so both emissions must reach the guard.
    expect(state.quit).toHaveBeenCalledTimes(2)
  })
})
