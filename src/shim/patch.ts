import { createOpenDocument, getSavedFileInfo, getSavedFileList, removeSavedFile, saveFile } from './apis/index'

/** Objects already patched, so repeated installs never double-wrap. */
const patched = new WeakSet<object>()

/**
 * Patch the given `uni` object with desktop-capable implementations for the
 * APIs uni-h5 does not implement. Everything H5 already ships keeps its
 * original implementation so desktop matches H5 behaviour.
 *
 * This covers the dev server, where the uni runtime fills the `uni` global
 * with its API object at runtime. Compiled builds route the calls through
 * uni-h5's module exports instead, which the `@uni-helper/desktop/vite`
 * plugin overrides at build time.
 */
export function patchUni(uni: Record<string, any>): void {
  if (!uni || typeof uni !== 'object' || patched.has(uni))
    return
  patched.add(uni)
  uni.saveFile = saveFile
  uni.getSavedFileList = getSavedFileList
  uni.getSavedFileInfo = getSavedFileInfo
  uni.removeSavedFile = removeSavedFile
  uni.openDocument = createOpenDocument(uni.openDocument)
}
