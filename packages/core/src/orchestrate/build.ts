import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { bakeConfig, resolveDesktopConfig } from '../config/resolve'
import { DesktopError } from '../error'
import { log } from '../log'
import { bundleEntry, bundlePreload } from './bundle'
import { detectPackageManager, runCommand, spawnAwait } from './pm'
import { packInternal } from './pack'
import { getTemplateDir } from './dev'

export interface BuildOptions {
  /** Project root, defaults to process.cwd() */
  cwd?: string
  /** Overrides `pack.autoPack` from the config */
  pack?: boolean
}

export interface BuildResult {
  outDir: string
}

/**
 * Build the H5 bundle, assemble a runnable Electron app directory at
 * `dist/desktop` and optionally run electron-builder on it.
 */
export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const { resolved, warnings } = await resolveDesktopConfig(options.cwd)
  for (const warning of warnings) log(warning)
  const root = resolved.root
  const outDir = join(root, 'dist/desktop')
  const templateDir = getTemplateDir()
  log('building the H5 bundle...')

  await rm(outDir, { recursive: true, force: true })

  const pm = detectPackageManager(root)
  const { cmd, args } = runCommand(pm, resolved.build.command)
  const webDir = join(outDir, 'web')
  await spawnAwait(cmd, args, { cwd: root, env: { ...process.env, UNI_OUTPUT_DIR: webDir } })

  if (!existsSync(join(webDir, 'index.html'))) {
    const fallback = join(root, 'dist/build/h5')
    if (!existsSync(join(fallback, 'index.html'))) {
      throw new DesktopError(
        `H5 build output not found (looked at ${webDir} and ${fallback}). `
        + `Make sure \`${resolved.build.command}\` produces an index.html.`,
      )
    }
    await cp(fallback, webDir, { recursive: true })
  }

  let iconPath: string | undefined
  if (resolved.icon) {
    const source = join(root, resolved.icon)
    if (existsSync(source)) {
      const target = join(outDir, 'resources/icon.png')
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
      iconPath = target
    }
  }
  const baked = bakeConfig(resolved, iconPath)

  log('assembling the electron app...')
  const electronDir = join(outDir, 'electron')
  await bundleEntry({
    entryPath: resolved.mainEntry ? join(root, resolved.mainEntry) : join(templateDir, 'main.ts'),
    outDir: electronDir,
    baked,
  })
  await bundlePreload({ outDir: electronDir, templateDir })

  await writeFile(join(outDir, 'package.json'), `${JSON.stringify({
    name: resolved.appId.toLowerCase(),
    productName: resolved.appName,
    version: resolved.version,
    private: true,
    main: 'electron/main.cjs',
  }, null, 2)}\n`)

  log(`desktop app assembled at ${outDir}`)

  const autoPack = options.pack ?? resolved.pack.autoPack
  if (autoPack)
    await packInternal(root, resolved, outDir)

  return { outDir }
}
