import type { ResolvedConfig } from '../config/resolve'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { APP_RESOURCES_DIR, appIconFileName, trayIconFileName } from './paths'

/**
 * Copy the window/tray icons into the assembled app and return the file names
 * the baked config should reference. Absolute paths would break once
 * electron-builder moves the directory, so only names cross the boundary.
 */
export async function copyAssets(resolved: Pick<ResolvedConfig, 'root' | 'icon' | 'tray'>, outDir: string): Promise<{ icon?: string, trayIcon?: string }> {
  const resourcesDir = join(outDir, APP_RESOURCES_DIR)
  const assets: { icon?: string, trayIcon?: string } = {}

  if (resolved.icon) {
    const source = join(resolved.root, resolved.icon)
    if (existsSync(source)) {
      const name = appIconFileName(source)
      await mkdir(resourcesDir, { recursive: true })
      await copyFile(source, join(resourcesDir, name))
      assets.icon = name
    }
  }

  const trayIcon = resolved.tray ? resolved.tray.icon : undefined
  if (trayIcon) {
    const source = join(resolved.root, trayIcon)
    if (existsSync(source)) {
      const name = trayIconFileName(source)
      await mkdir(resourcesDir, { recursive: true })
      await copyFile(source, join(resourcesDir, name))
      assets.trayIcon = name
    }
  }

  return assets
}
