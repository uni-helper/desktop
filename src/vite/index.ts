import type { Plugin, ViteDevServer, ResolvedConfig as ViteResolvedConfig } from 'vite'
import type { ResolveResult } from '../config/resolve'
import type { DesktopDevRuntimeHandle } from './driver'
import { resolve } from 'node:path'
import process from 'node:process'
import { DesktopError } from '../error'
import { logger } from '../log'
import { assembleDesktopApp, isDesktopBuild, startDesktopDevRuntime } from './driver'
import { ensureDesktopProject, ensureDesktopUniScript } from './setup'

/** The module whose API exports the desktop shim must override. */
const UNI_H5_ID = '@dcloudio/uni-h5'

/** Virtual module standing in for uni-h5 inside the renderer build. */
const WRAPPER_ID = '\0uni-desktop/uni-h5'

const DESKTOP_APIS_IMPORT = '@uni-helper/desktop/shim/apis'
const SHIM_IMPORT = '@uni-helper/desktop/shim'

/**
 * The wrapper re-exports everything uni-h5 ships, but replaces the uni APIs
 * the desktop shim provides (the saved-file set, `getUpdateManager`, the
 * `getFileSystemManager` factory) and `openDocument` (a `window.open` on H5,
 * which cannot hand a file to the OS) with the desktop implementations, and
 * installs the runtime shim as a module side effect. The export list is
 * explicit and kept in sync by hand with the channel groups in
 * `shim/channels`: every name here has its invoke channel there.
 *
 * uni's vite pipeline rewrites every `uni.xxx(...)` call in app code into
 * `import { xxx } from '@dcloudio/uni-h5'` in tree-shaken builds, or leaves it
 * as a free variable resolved on the `uni` global (dev server, where uni's
 * pages-json module fills the global from an import of this wrapper). The
 * export overrides cover the compiled path. `installDesktopShim` covers the
 * global path: the wrapper is in every desktop module graph and evaluates
 * before uni assigns the global.
 */
function wrapperSource(): string {
  return `import { installDesktopShim } from '${SHIM_IMPORT}'
export * from '${UNI_H5_ID}'
import { openDocument as openDocumentH5 } from '${UNI_H5_ID}'
import { createOpenDocument } from '${DESKTOP_APIS_IMPORT}'
export { saveFile, getSavedFileList, getSavedFileInfo, removeSavedFile, getUpdateManager, getFileSystemManager } from '${DESKTOP_APIS_IMPORT}'
export const openDocument = createOpenDocument(openDocumentH5)
installDesktopShim()
`
}

/**
 * The URL the desktop shell loads: the `DESKTOP_DEV_URL` override (set by
 * tooling), then an explicitly configured `dev.url`, then the address the uni
 * dev server actually bound (respects `--port`/`--host`).
 */
function devUrl(server: ViteDevServer, result: ResolveResult): string {
  const override = process.env.DESKTOP_DEV_URL
  if (override)
    return override
  const configured = result.userConfig?.dev?.url
  if (configured)
    return configured
  const address = server.httpServer?.address()
  if (address && typeof address === 'object') {
    const localhost = ['127.0.0.1', '0.0.0.0', '::', '::1'].includes(address.address)
    const hostname = localhost ? 'localhost' : address.address
    const protocol = server.config.server.https ? 'https' : 'http'
    return `${protocol}://${hostname}:${address.port}`
  }
  return result.resolved.dev.url
}

/**
 * The uni-app desktop platform: one vite plugin, no CLI. Add it next to
 * `uni()` in the project's `vite.config.ts` and run the desktop platform
 * through uni itself (`uni dev -p desktop` / `uni build -p desktop`):
 *
 * ```ts
 * import uni from '@dcloudio/vite-plugin-uni'
 * import { defineConfig } from 'vite'
 * import { uniDesktop } from '@uni-helper/desktop/vite'
 *
 * export default defineConfig({
 *   plugins: [uni(), uniDesktop()],
 * })
 * ```
 *
 * In a desktop build (`#ifdef DESKTOP` compiled in) the plugin also drives the
 * platform: it checks and fixes the project setup on startup, installs the
 * desktop shim into the page through the uni-h5 wrapper, dev opens an Electron
 * window once the server listens, build assembles `dist/build/desktop` and
 * packs it. Other platforms are untouched.
 */
export function uniDesktop(): Plugin {
  let root = ''
  let desktop = false
  let viteConfig: ViteResolvedConfig | undefined
  let project: ResolveResult | undefined

  return {
    name: 'uni-desktop:override-uni-h5',
    enforce: 'pre',
    config() {
      // Keep the shim entries out of dep pre-bundling: the optimizeDeps hash
      // ignores dist content, so an SDK rebuild would serve a stale chunk
      // missing newly added exports. Excluded ESM deps are served as source.
      // Unconditional: excluding never-imported specifiers is inert.
      return {
        optimizeDeps: {
          exclude: [SHIM_IMPORT, DESKTOP_APIS_IMPORT],
        },
      }
    },
    resolveId: {
      // uni's own pre-group resolver maps `@dcloudio/uni-h5` to an absolute
      // file path in one hop, so anything ordered after it never sees the bare
      // specifier. `order: 'pre'` sorts this hook ahead of it regardless of
      // where the plugin sits in the user's `plugins` array.
      order: 'pre',
      async handler(source, importer, options) {
        if (source !== UNI_H5_ID)
          return
        // The wrapper itself must see the real uni-h5 module, not itself.
        if (importer === WRAPPER_ID)
          return await this.resolve(UNI_H5_ID, importer, { skipSelf: true, ...options })
        return WRAPPER_ID
      },
    },
    load(id) {
      if (id === WRAPPER_ID) {
        return {
          code: wrapperSource(),
          map: null,
        }
      }
    },
    configResolved(config) {
      root = config.root
      viteConfig = config
      desktop = isDesktopBuild()
      // `-p desktop` without a matching `uni-app.scripts.desktop` entry leaves
      // UNI_PLATFORM as the raw name and fails inside uni with a confusing
      // error; create the missing entry (the one wiring the self-check refuses
      // to leave missing) and ask for a re-run, since this process already
      // resolved UNI_PLATFORM wrong.
      if (process.env.UNI_PLATFORM === 'desktop') {
        ensureDesktopUniScript(root)
        throw new DesktopError(
          `\`uni -p desktop\` needs the \`uni-app.scripts.desktop\` custom platform, which was just added to package.json.\nRe-run the command to apply it.`,
        )
      }
    },
    configureServer: {
      async handler(server) {
        if (!desktop)
          return
        const result = await ensureDesktopProject(root)
        project = result
        // Post hook: runs after vite's internal middlewares are installed.
        return () => {
          const httpServer = server.httpServer
          if (!httpServer)
            return
          let devRuntime: DesktopDevRuntimeHandle | undefined
          httpServer.once('listening', () => {
            startDesktopDevRuntime(result.resolved, devUrl(server, result))
              .then((runtime) => {
                devRuntime = runtime
              })
              .catch((error: unknown) => {
                logger.error(error instanceof Error ? error.message : String(error))
              })
          })
          httpServer.once('close', () => {
            void devRuntime?.close()
          })
        }
      },
    },
    async buildStart() {
      if (!desktop)
        return
      // Runs before any module is transformed, so manifest fixes land in the
      // same build they were detected in.
      project = await ensureDesktopProject(root)
    },
    async closeBundle() {
      // `project` is only set for desktop builds, and vite runs configResolved
      // and buildStart before closeBundle, so both are set here.
      if (!project)
        return
      const webDir = resolve(viteConfig!.root, viteConfig!.build.outDir)
      await assembleDesktopApp(project.resolved, webDir)
    },
  }
}
