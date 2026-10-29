/** Directory (relative to the project root) holding the assembled app. */
export const APP_DIR = 'dist/desktop'

/** Directory (relative to the app dir) holding assets referenced by the baked config. */
export const APP_RESOURCES_DIR = 'resources'

/** File name of the window icon inside the app resources directory. */
export function appIconFileName(iconPath: string): string {
  return `icon${extensionOf(iconPath)}`
}

/** File name of the tray icon inside the app resources directory. */
export function trayIconFileName(iconPath: string): string {
  return `tray-icon${extensionOf(iconPath)}`
}

function extensionOf(filePath: string): string {
  const index = filePath.lastIndexOf('.')
  return index === -1 ? '.png' : filePath.slice(index)
}
