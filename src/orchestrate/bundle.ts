import type { BuildContext, Plugin } from 'esbuild'
import type { BakedDesktopConfig } from '../baked'
import { join } from 'node:path'
import { build, context } from 'esbuild'
import { logger } from '../log'

// `electron` must stay a runtime require; electron-updater is bundled so the
// packaged app (which ships no node_modules) can still auto-update.
const ELECTRON_EXTERNALS = ['electron']

export interface BundleEntryOptions {
  /** Absolute path to the main process entry (template or custom) */
  entryPath: string
  /** Directory receiving `main.cjs` */
  outDir: string
  baked: BakedDesktopConfig
  /** esbuild aliases, used by tests to map workspace sources */
  alias?: Record<string, string>
  watch?: boolean
  onRebuild?: () => void
}

export interface BundlePreloadOptions {
  /** Directory containing the `preload.ts` template */
  templateDir: string
  /** Directory receiving `preload.cjs` */
  outDir: string
  /** esbuild aliases, used by tests to map workspace sources */
  alias?: Record<string, string>
}

function watchPlugin(onRebuild: () => void): Plugin {
  let initial = true
  return {
    name: 'uni-desktop-watch',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          logger.error('main process rebuild failed:', result.errors[0]?.text)
          return
        }
        // The initial build's output is exactly what `dev` spawns with, and its
        // completion races the electron spawn: firing a restart on it would
        // kill the app right after launch, whichever order they finish in.
        if (initial) {
          initial = false
          return
        }
        onRebuild()
      })
    },
  }
}

export async function bundleEntry(options: BundleEntryOptions): Promise<BuildContext | undefined> {
  const buildOptions = {
    entryPoints: [options.entryPath],
    bundle: true,
    platform: 'node' as const,
    format: 'cjs' as const,
    target: 'node18',
    outfile: join(options.outDir, 'main.cjs'),
    external: ELECTRON_EXTERNALS,
    alias: options.alias,
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json', '.css'],
    define: { __DESKTOP_CONFIG__: JSON.stringify(options.baked) },
    logLevel: 'silent' as const,
    plugins: options.watch ? [watchPlugin(() => options.onRebuild?.())] : undefined,
  }

  if (!options.watch) {
    await build(buildOptions)
    return undefined
  }

  const ctx = await context(buildOptions)
  await ctx.watch()
  return ctx
}

export async function bundlePreload(options: BundlePreloadOptions): Promise<void> {
  await build({
    entryPoints: [join(options.templateDir, 'preload.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: join(options.outDir, 'preload.cjs'),
    external: ['electron'],
    alias: options.alias,
    logLevel: 'silent',
  })
}
