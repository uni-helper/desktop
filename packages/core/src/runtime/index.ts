import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, realpath, stat, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join, sep } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, shell, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { BakedDesktopConfig } from '../baked'
import { shimChannels } from '@uni-helper/desktop-shim'
import { DESKTOP_FILE_SCHEME, mimeFromExtension, parseDesktopFileUrl, toDesktopFileUrl } from '../shared/protocol'

export { DESKTOP_FILE_SCHEME, parseDesktopFileUrl, toDesktopFileUrl }

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function tempRoot(): string {
  return join(app.getPath('temp'), 'uni-desktop-uploads')
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
    if (!isInsideRoots(resolved, [tempRoot(), savedRoot()]))
      return new Response('forbidden', { status: 403 })
    const data = await readFile(resolved)
    return new Response(new Uint8Array(data), { headers: { 'content-type': mimeFromExtension(resolved) } })
  }
  catch {
    return new Response('not found', { status: 404 })
  }
}

const DEFAULT_CHOOSE_EXTENSIONS: Record<'image' | 'video' | 'file', string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'],
  video: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'm4v'],
  file: [],
}

function buildDialogFilters(kind: 'image' | 'video' | 'file', extensions: string[] | undefined): { name: string, extensions: string[] }[] | undefined {
  const list = extensions?.length ? extensions : DEFAULT_CHOOSE_EXTENSIONS[kind]
  return list.length > 0 ? [{ name: kind, extensions: list }] : undefined
}

async function copyIntoTempRoot(sourcePath: string): Promise<{ originalPath: string, tempPath: string, name: string, size: number }> {
  await mkdir(tempRoot(), { recursive: true })
  const target = join(tempRoot(), `${randomUUID()}${extname(sourcePath)}`)
  await copyFile(sourcePath, target)
  const stats = await stat(target)
  return {
    originalPath: sourcePath,
    tempPath: toDesktopFileUrl(target),
    name: basename(sourcePath),
    size: stats.size,
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(shimChannels.setClipboardData, (_event, payload) => {
    const data = assertObjectPayload(payload).data
    if (typeof data !== 'string')
      throw new TypeError('data must be a string')
    clipboard.writeText(data)
    return {}
  })

  ipcMain.handle(shimChannels.getClipboardData, () => ({ data: clipboard.readText() }))

  ipcMain.handle(shimChannels.chooseFile, async (event, payload) => {
    const data = assertObjectPayload(payload)
    const kind = data.kind
    if (kind !== 'image' && kind !== 'video' && kind !== 'file')
      throw new TypeError('kind must be image, video or file')
    const count = Math.max(1, Math.min(50, Number(data.count) || 1))
    const extensions = Array.isArray(data.extensions)
      ? data.extensions.filter((item): item is string => typeof item === 'string')
      : undefined
    const options = {
      properties: count > 1 ? ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> : ['openFile'] as Array<'openFile'>,
      filters: buildDialogFilters(kind, extensions),
    }
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0)
      throw new Error('cancel')
    const files = await Promise.all(result.filePaths.slice(0, count).map(copyIntoTempRoot))
    return { files }
  })

  ipcMain.handle(shimChannels.saveFile, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const source = await pathFromManagedValue(data.tempFilePath, [tempRoot()], 'tempFilePath')
    await mkdir(savedRoot(), { recursive: true })
    const target = join(savedRoot(), `${randomUUID()}${extname(source)}`)
    await copyFile(source, target)
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

  ipcMain.handle(shimChannels.removeSavedFile, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const filePath = await pathFromManagedValue(data.filePath, [savedRoot()], 'filePath')
    await unlink(filePath)
    return {}
  })

  ipcMain.handle(shimChannels.openDocument, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const filePath = await pathFromManagedValue(data.filePath, [tempRoot(), savedRoot()], 'filePath')
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
