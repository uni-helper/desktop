import type { ResolvedConfig } from '../config/resolve'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { APP_RESOURCES_DIR, appIconFileName, trayIconFileName } from './paths'

/**
 * Copy the window/tray icons into the assembled app and return the file names
 * the baked config should reference. Absolute paths would break once
 * electron-builder moves the directory, so only names cross the boundary.
 *
 * The app icon path is absolute and always set (the config resolver defaults it
 * to the built-in uni-helper icon), so a copy failure is a real error instead
 * of a silently missing icon. The tray icon is only copied when the tray is
 * enabled.
 */
export async function copyAssets(resolved: Pick<ResolvedConfig, 'icon' | 'tray'>, outDir: string): Promise<{ icon: string, trayIcon?: string }> {
  const resourcesDir = join(outDir, APP_RESOURCES_DIR)
  await mkdir(resourcesDir, { recursive: true })

  const icon = appIconFileName(resolved.icon)
  await copyFile(resolved.icon, join(resourcesDir, icon))

  if (!resolved.tray)
    return { icon }

  const trayIcon = trayIconFileName(resolved.tray.icon)
  await copyFile(resolved.tray.icon, join(resourcesDir, trayIcon))
  return { icon, trayIcon }
}
