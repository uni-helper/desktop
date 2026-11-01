import type { HtmlTagDescriptor, Plugin, ViteDevServer, ResolvedConfig as ViteResolvedConfig } from 'vite'
import type { ResolveResult } from '../config/resolve'
import type { DesktopDevRuntimeHandle } from './driver'
import { resolve } from 'node:path'
import process from 'node:process'
import { DesktopError } from '../error'
import { logger } from '../log'
import { desktopScriptSnippet } from '../shared/scripts'
import { assembleDesktopApp, isDesktopBuild, startDesktopDevRuntime } from './driver'
import { ensureDesktopProject } from './setup'

/** The module whose API exports the desktop shim must override. */
const UNI_H5_ID = '@dcloudio/uni-h5'

/** Virtual module standing in for uni-h5 inside the renderer build. */
const WRAPPER_ID = '\0uni-desktop/uni-h5'

/** Virtual module that installs the desktop shim into the page. */
const SHIM_INSTALL_ID = '\0uni-desktop/shim-install'

/** The dev-server URL serving the shim virtual module (`\0` becomes `__x00__`). */
const SHIM_INSTALL_URL = '/@id/__x00__uni-desktop/shim-install'

/**
 * Deterministic output name of the shim chunk in the built renderer. Vite
 * injects `transformIndexHtml` tags verbatim after bundling, so the tag cannot
 * go through module resolution: the chunk is emitted in `buildStart` under a
 * fixed name and referenced relative to `index.html` (uni's h5 base is `./`).
 */
const SHIM_CHUNK = 'uni-desktop-shim.js'

const DESKTOP_APIS_IMPORT = '@uni-helper/desktop/shim/apis'
const SHIM_IMPORT = '@uni-helper/desktop/shim'

/**
 * The wrapper re-exports everything uni-h5 ships, but replaces the saved-file
 * APIs (unsupported stubs on H5) and `openDocument` (a `window.open` on H5,
 * which cannot hand a file to the OS) with the desktop implementations.
 *
 * uni's vite pipeline rewrites every `uni.xxx(...)` call in app code into
 * `import { xxx } from '@dcloudio/uni-h5'` (tree-shaken builds) or leaves it
 * as a free variable resolved on the `uni` global (dev server). The module
 * override covers the compiled path; the shim injected into the page covers
 * the global path.
 */
function wrapperSource(): string {
  return `export * from '${UNI_H5_ID}'
import { openDocument as openDocumentH5 } from '${UNI_H5_ID}'
import { createOpenDocument } from '${DESKTOP_APIS_IMPORT}'
export { getSavedFileInfo, getSavedFileList, removeSavedFile, saveFile } from '${DESKTOP_APIS_IMPORT}'
export const openDocument = createOpenDocument(openDocumentH5)
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
 * platform: it checks and fixes the project setup on startup, injects the
 * desktop shim into the page, dev opens an Electron window once the server
 * listens, build assembles `dist/build/desktop` and packs it. Other platforms
 * are untouched.
 */
export function uniDesktop(): Plugin {
  let root = ''
  let desktop = false
  let viteConfig: ViteResolvedConfig | undefined
  let project: ResolveResult | undefined

  return {
    name: 'uni-desktop:override-uni-h5',
    enforce: 'pre',
    resolveId: {
      // uni's own pre-group resolver maps `@dcloudio/uni-h5` to an absolute
      // file path in one hop, so anything ordered after it never sees the bare
      // specifier. `order: 'pre'` sorts this hook ahead of it regardless of
      // where the plugin sits in the user's `plugins` array.
      order: 'pre',
      async handler(source, importer, options) {
        if (source === SHIM_INSTALL_ID)
          return SHIM_INSTALL_ID
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
      // A bare side-effect import: the shim entry installs the `window.uni`
      // assignment interceptor, so evaluation order against uni's runtime
      // never matters (late fills hit the interceptor).
      if (id === SHIM_INSTALL_ID)
        return { code: `import '${SHIM_IMPORT}'\n`, map: null }
    },
    /**
     * Inject the shim module into the page; dev and build share one
     * mechanism, only the URL differs. Without it the global `uni` path (the
     * only path on the dev server) would go unpatched, and that requires no
     * import in user code. A plain function hook: it must stay in the normal
     * phase, because vite's build runs pre hooks before its script-collection
     * traversal and would treat the injected tag as an unresolvable entry.
     */
    transformIndexHtml(): HtmlTagDescriptor[] | undefined {
      if (!desktop)
        return
      const src = viteConfig!.command === 'serve' ? SHIM_INSTALL_URL : `./${SHIM_CHUNK}`
      return [{ tag: 'script', attrs: { type: 'module', src }, injectTo: 'head-prepend' }]
    },
    configResolved(config) {
      root = config.root
      viteConfig = config
      desktop = isDesktopBuild()
      // `-p desktop` without a matching `uni-app.scripts.desktop` entry leaves
      // UNI_PLATFORM as the raw name and fails inside uni with a confusing
      // error; surface the missing piece instead.
      if (process.env.UNI_PLATFORM === 'desktop') {
        throw new DesktopError(
          `\`uni -p desktop\` needs the \`uni-app.scripts.desktop\` custom platform in package.json:\n\n${
            desktopScriptSnippet()}`,
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
      // The chunk the injected script tag loads: emitted with a fixed name so
      // `transformIndexHtml` can reference it after the module graph is sealed.
      this.emitFile({ type: 'chunk', id: SHIM_INSTALL_ID, fileName: SHIM_CHUNK })
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
