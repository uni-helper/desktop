import type { Plugin } from 'vite'

/** The module whose API exports the desktop shim must override. */
const UNI_H5_ID = '@dcloudio/uni-h5'

/** Virtual module standing in for uni-h5 inside the renderer build. */
const WRAPPER_ID = '\0uni-desktop/uni-h5'

const DESKTOP_APIS_IMPORT = '@uni-helper/desktop/shim/apis'

/**
 * The wrapper re-exports everything uni-h5 ships, but replaces the saved-file
 * APIs (unsupported stubs on H5) and `openDocument` (a `window.open` on H5,
 * which cannot hand a file to the OS) with the desktop implementations.
 *
 * uni's vite pipeline rewrites every `uni.xxx(...)` call in app code into
 * `import { xxx } from '@dcloudio/uni-h5'` (tree-shaken builds) or leaves it
 * as a free variable resolved on the `uni` global (dev server). The module
 * override covers the compiled path, the runtime patch in
 * `@uni-helper/desktop/shim` covers the global path.
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
 * Vite plugin that routes uni-h5 API calls through the desktop shim. Add it
 * next to `uni()` in the project's `vite.config.ts`:
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
 */
export function uniDesktop(): Plugin {
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
        if (source !== UNI_H5_ID)
          return
        // The wrapper itself must see the real uni-h5 module, not itself.
        if (importer === WRAPPER_ID)
          return await this.resolve(UNI_H5_ID, importer, { skipSelf: true, ...options })
        return WRAPPER_ID
      },
    },
    load(id) {
      if (id !== WRAPPER_ID)
        return
      return {
        code: wrapperSource(),
        map: null,
      }
    },
  }
}
