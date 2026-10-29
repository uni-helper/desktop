import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join, sep } from 'node:path'
import { app, BrowserWindow, Menu, ipcMain, protocol, shell, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { BakedDesktopConfig } from '../baked'
import { shimChannels } from '@uni-helper/desktop-shim'
import { DESKTOP_FILE_SCHEME, mimeFromExtension, parseDesktopFileUrl, toDesktopFileUrl } from '../shared/protocol'

export { DESKTOP_FILE_SCHEME, parseDesktopFileUrl, toDesktopFileUrl }

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function savedRoot(): string {
  return join(app.getPath('userData'), 'uni-desktop-files')
}

function isInsideRoots(resolved: string, roots: string[]): boolean {
  return roots.some(root => resolved === root || resolved.startsWith(root + sep))
}

async function pathFromManagedValue(value: unknown, roots: string[], label: string): Promise<string> {
  if (typeof value !== 'string' || !value)
    throw new TypeError(`${label} is required`)
  const raw = value.startsWith(`${DESKTOP_FILE_SCHEME}://`) ? parseDesktopFileUrl(value) : value
  const resolved = await realpath(raw)
  if (!isInsideRoots(resolved, roots))
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
    const resolved = await realpath(parseDesktopFileUrl(request.url))
    if (!isInsideRoots(resolved, [savedRoot()]))
      return new Response('forbidden', { status: 403 })
    const data = await readFile(resolved)
    return new Response(new Uint8Array(data), { headers: { 'content-type': mimeFromExtension(resolved) } })
  }
  catch {
    return new Response('not found', { status: 404 })
  }
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/json': '.json',
  'application/zip': '.zip',
}

function registerIpcHandlers(): void {
  // The renderer sends bytes because uni-h5 hands out `blob:` temp paths,
  // which the main process cannot resolve on its own.
  ipcMain.handle(shimChannels.saveFile, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const base64 = data.base64
    if (typeof base64 !== 'string' || !base64)
      throw new TypeError('base64 must be a string')
    const mime = typeof data.mime === 'string' ? data.mime : undefined
    const extension = mime ? EXTENSION_BY_MIME[mime] ?? '' : ''
    await mkdir(savedRoot(), { recursive: true })
    const target = join(savedRoot(), `${randomUUID()}${extension}`)
    await writeFile(target, Buffer.from(base64, 'base64'))
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

function createMainWindow(baked: BakedDesktopConfig): BrowserWindow {
  if (mainWindow) {
    mainWindow.focus()
    return mainWindow
  }
  const window = baked.window
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
    icon: baked.iconPath && existsSync(baked.iconPath) ? baked.iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devUrl = process.env.DESKTOP_DEV_URL
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
  if (!trayConfig?.iconPath)
    return
  try {
    const tray = new Tray(trayConfig.iconPath)
    if (trayConfig.tooltip)
      tray.setToolTip(trayConfig.tooltip)
    const template: MenuItemConstructorOptions[] = (trayConfig.menu ?? [{ role: 'quit' }]).map(item => ({
      label: item.label,
      role: item.role as MenuItemConstructorOptions['role'],
      enabled: item.enabled,
      visible: item.visible,
    }))
    tray.setContextMenu(Menu.buildFromTemplate(template))
    tray.on('click', () => mainWindow?.show())
  }
  catch (error) {
    console.warn('[uni-desktop] failed to create tray:', error)
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
      console.log('[uni-desktop] update downloaded, it will be installed on quit')
    })
    await autoUpdater.checkForUpdates()
  }
  catch (error) {
    console.warn('[uni-desktop] auto update unavailable:', error instanceof Error ? error.message : error)
  }
}

/**
 * Boot the desktop app from a baked config. Call it at the top level of the
 * main process entry so the custom protocol is registered before `ready`.
 */
export function createDesktopApp(baked: BakedDesktopConfig): void {
  registerDesktopFileProtocol()
  registerIpcHandlers()

  void app.whenReady().then(async () => {
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
