import type { MenuItemConstructorOptions } from 'electron'
import type { BakedDesktopConfig } from '../baked'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createConsola } from 'consola/basic'
import { app, BrowserWindow, ipcMain, Menu, protocol, shell, Tray } from 'electron'
import { DESKTOP_FILE_SCHEME, EXTENSION_BY_MIME, mimeFromExtension, parseDesktopFileUrl, toDesktopFileUrl } from '../shared/protocol'
import { shimChannels } from '../shim/channels'

export type { BakedDesktopConfig } from '../baked'
export { DESKTOP_FILE_SCHEME, parseDesktopFileUrl, toDesktopFileUrl }

/**
 * The basic reporter instead of the fancy one: this module ends up bundled into
 * the packaged app's `main.cjs`, where the full consola (colors, box drawing,
 * prompts) would add ~110 kB for a handful of diagnostics. Main process output
 * is read from a terminal or the OS log, so one plain line per message is enough.
 */
const logger = createConsola({
  defaults: { tag: 'uni-desktop' },
  formatOptions: { date: false },
})

let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function savedRoot(): string {
  return join(app.getPath('userData'), 'uni-desktop-files')
}

/**
 * Directory holding the assets baked into the app (`icon.png`,
 * `tray-icon.png`). In dev that is the assembled app directory; once packaged
 * electron-builder moves the same files into `resources/`.
 */
function assetsRoot(): string {
  return join(__dirname, '..', 'resources')
}

/**
 * Absolute path of an asset inside the app resources directory. Existence is
 * not re-checked here: the config resolver validated the sources and
 * `copyAssets` copied them, so a missing file surfaces through Electron
 * directly instead of degrading silently.
 */
function assetPath(fileName: string | undefined): string | undefined {
  return fileName ? join(assetsRoot(), fileName) : undefined
}

/**
 * Fallback icon assignment for the macOS Dock: the bundle that dev launches is
 * a clone of Electron's, patched to carry the app icon (see the dev
 * orchestration), and packaged apps get theirs from electron-builder. This
 * covers the cases where the bundle could not be patched or its icon
 * converted. Windows and Linux take the icon from `BrowserWindow`, which is
 * set at window creation.
 */
function applyDockIcon(iconFileName: string | undefined): void {
  if (process.platform !== 'darwin')
    return
  const iconPath = assetPath(iconFileName)
  if (iconPath)
    app.dock?.setIcon(iconPath)
}

function isInsideRoots(resolved: string, roots: string[]): boolean {
  return roots.some(root => resolved === root || resolved.startsWith(root + sep))
}

/**
 * Resolve a renderer-supplied path to a real path inside one of the managed
 * roots. The roots are realpath-ed too, otherwise a symlinked home directory
 * would make every legitimate path look like it escaped containment.
 */
async function pathFromManagedValue(value: unknown, roots: string[], label: string): Promise<string> {
  if (typeof value !== 'string' || !value)
    throw new TypeError(`${label} is required`)
  const raw = value.startsWith(`${DESKTOP_FILE_SCHEME}://`) ? parseDesktopFileUrl(value) : value
  const resolved = await realpath(raw)
  const realRoots = await Promise.all(roots.map(root => realpath(root).catch(() => root)))
  if (!isInsideRoots(resolved, realRoots))
    throw new Error(`${label} is outside the managed directories`)
  return resolved
}

function assertObjectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('payload must be an object')
  return value as Record<string, unknown>
}

let protocolRegistered = false

function registerDesktopFileProtocol(): void {
  if (protocolRegistered)
    return
  protocolRegistered = true
  protocol.registerSchemesAsPrivileged([
    { scheme: DESKTOP_FILE_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } },
  ])
}

async function serveDesktopFileRequest(request: Request): Promise<Response> {
  try {
    const root = await realpath(savedRoot())
    const resolved = await realpath(parseDesktopFileUrl(request.url))
    if (!isInsideRoots(resolved, [root]))
      return new Response('forbidden', { status: 403 })
    const data = await readFile(resolved)
    return new Response(new Uint8Array(data), { headers: { 'content-type': mimeFromExtension(resolved) } })
  }
  catch {
    return new Response('not found', { status: 404 })
  }
}

function registerIpcHandlers(): void {
  // The renderer sends bytes because uni-h5 hands out `blob:` temp paths,
  // which the main process cannot resolve on its own. `bytes` is an ArrayBuffer
  // transferred over IPC, so large files never become a base64 string.
  ipcMain.handle(shimChannels.saveFile, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const bytes = data.bytes
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer))
      throw new TypeError('bytes must be a Uint8Array or ArrayBuffer')
    const mime = typeof data.mime === 'string' ? data.mime : undefined
    const extension = mime ? EXTENSION_BY_MIME[mime] ?? '' : ''
    await mkdir(savedRoot(), { recursive: true })
    const target = join(savedRoot(), `${randomUUID()}${extension}`)
    await writeFile(target, bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
    return { savedFilePath: toDesktopFileUrl(target) }
  })

  ipcMain.handle(shimChannels.getSavedFileList, async () => {
    await mkdir(savedRoot(), { recursive: true })
    const names = await readdir(savedRoot())
    const fileList = await Promise.all(names.map(async (name) => {
      const filePath = join(savedRoot(), name)
      const stats = await stat(filePath)
      return { filePath: toDesktopFileUrl(filePath), size: stats.size, createTime: Math.round(stats.birthtimeMs) }
    }))
    return { fileList }
  })

  ipcMain.handle(shimChannels.getSavedFileInfo, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const filePath = await pathFromManagedValue(data.filePath, [savedRoot()], 'filePath')
    const stats = await stat(filePath)
    return { size: stats.size, createTime: Math.round(stats.birthtimeMs) }
  })

  ipcMain.handle(shimChannels.removeSavedFile, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const filePath = await pathFromManagedValue(data.filePath, [savedRoot()], 'filePath')
    await unlink(filePath)
    return {}
  })

  ipcMain.handle(shimChannels.openDocument, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const filePath = await pathFromManagedValue(data.filePath, [savedRoot()], 'filePath')
    const errorMessage = await shell.openPath(filePath)
    if (errorMessage)
      throw new Error(errorMessage)
    return {}
  })
}

/**
 * Keep the renderer on app-owned content: external links open in the system
 * browser and nothing can navigate the window away from the app. Without this
 * the preload bridge (and therefore the file IPC) would be handed to any
 * remote page the renderer navigates to. Checks compare parsed URLs, not
 * string prefixes: `http://localhost:5173.evil.com` must not pass a devUrl of
 * `http://localhost:5173`.
 */
function hardenNavigation(window: BrowserWindow, devUrl: string | undefined): void {
  let devOrigin: string | undefined
  try {
    devOrigin = devUrl ? new URL(devUrl).origin : undefined
  }
  catch {
    logger.warn(`invalid DESKTOP_DEV_URL, external navigation stays blocked: ${devUrl}`)
  }
  // The packaged app's own pages, inside the asar; every other file:// url is
  // renderer-controlled content and must not load in this window.
  const webDir = join(__dirname, '..', 'web')

  const openExternal = (url: string): void => {
    let parsed: URL
    try {
      parsed = new URL(url)
    }
    catch {
      // Renderer-supplied urls can be malformed (e.g. `http://localhost:5173@`).
      // Unclassifiable means untrusted: nothing is handed to the shell.
      return
    }
    // Only web links go to the OS shell: other schemes reach OS handlers that
    // can execute content, and this window's renderer is not trusted.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return
    shell.openExternal(url).catch((error: unknown) => {
      logger.warn(`failed to open ${url}:`, error instanceof Error ? error.message : error)
    })
  }

  const isAppUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      if (devOrigin)
        return parsed.origin === devOrigin
      if (parsed.protocol !== 'file:')
        return false
      return join(fileURLToPath(parsed), sep).startsWith(join(webDir, sep))
    }
    catch {
      return false
    }
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url))
      return { action: 'allow' }
    openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url))
      return
    event.preventDefault()
    openExternal(url)
  })
}

function createMainWindow(baked: BakedDesktopConfig): BrowserWindow {
  if (mainWindow) {
    mainWindow.focus()
    return mainWindow
  }
  const window = baked.window
  const devUrl = process.env.DESKTOP_DEV_URL
  mainWindow = new BrowserWindow({
    title: window.title,
    width: window.width,
    height: window.height,
    minWidth: window.minWidth,
    minHeight: window.minHeight,
    center: window.center,
    resizable: window.resizable,
    fullscreen: window.fullscreen,
    frame: window.frame,
    titleBarStyle: window.titleBarStyle,
    autoHideMenuBar: window.autoHideMenuBar,
    backgroundColor: window.backgroundColor,
    show: window.show,
    alwaysOnTop: window.alwaysOnTop,
    kiosk: window.kiosk,
    icon: assetPath(baked.icon),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  hardenNavigation(mainWindow, devUrl)

  if (devUrl)
    void mainWindow.loadURL(devUrl)
  else
    void mainWindow.loadFile(join(__dirname, '../web/index.html'))

  if (baked.dev.openDevtools)
    mainWindow.webContents.openDevTools({ mode: 'detach' })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
  return mainWindow
}

function setupTray(baked: BakedDesktopConfig): void {
  const trayConfig = baked.tray ? baked.tray : undefined
  const iconPath = assetPath(trayConfig?.icon)
  if (!iconPath)
    return
  try {
    const tray = new Tray(iconPath)
    if (trayConfig?.tooltip)
      tray.setToolTip(trayConfig.tooltip)
    const template: MenuItemConstructorOptions[] = (trayConfig?.menu ?? [{ role: 'quit' }]).map(item => ({
      label: item.label,
      role: item.role as MenuItemConstructorOptions['role'],
      enabled: item.enabled,
      visible: item.visible,
    }))
    tray.setContextMenu(Menu.buildFromTemplate(template))
    tray.on('click', () => getMainWindow()?.show())
  }
  catch (error) {
    logger.error('failed to create tray:', error)
  }
}

async function setupUpdater(baked: BakedDesktopConfig): Promise<void> {
  const updater = baked.updater
  if (!updater)
    return
  try {
    const { autoUpdater } = await import('electron-updater')
    if (updater.autoDownload !== undefined)
      autoUpdater.autoDownload = updater.autoDownload
    if (updater.autoInstallOnAppQuit !== undefined)
      autoUpdater.autoInstallOnAppQuit = updater.autoInstallOnAppQuit
    autoUpdater.on('update-downloaded', () => {
      logger.success('update downloaded, it will be installed on quit')
    })
    await autoUpdater.checkForUpdates()
  }
  catch (error) {
    logger.warn('auto update unavailable:', error instanceof Error ? error.message : error)
  }
}

/**
 * Boot the desktop app from a baked config. Call it at the top level of the
 * main process entry so the custom protocol is registered before `ready`.
 */
export function createDesktopApp(baked: BakedDesktopConfig): void {
  registerDesktopFileProtocol()
  registerIpcHandlers()

  // Match the packaged app: `userData` (and with it the single-instance lock
  // and the menu roles) follows the app name, which would otherwise stay
  // "Electron" in dev. Must run before `ready` to affect `userData`.
  app.setName(baked.appName)

  // A desktop app is single-instance: a second launch focuses the running
  // window instead of starting a second copy of the app.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    const window = getMainWindow()
    if (!window)
      return
    if (window.isMinimized())
      window.restore()
    window.focus()
  })

  void app.whenReady().then(async () => {
    applyDockIcon(baked.icon)
    protocol.handle(DESKTOP_FILE_SCHEME, serveDesktopFileRequest)
    createMainWindow(baked)
    setupTray(baked)
    await setupUpdater(baked)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createMainWindow(baked)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
      app.quit()
  })
}
