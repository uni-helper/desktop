import { patchOpenDocument } from './apis/open-document'
import { patchSavedFile } from './apis/saved-file'

/**
 * Only APIs that uni-h5 does not implement are patched. Everything H5 already
 * ships keeps its original implementation so desktop matches H5 behaviour.
 */
export function patchUni(uni: Record<string, any>): void {
  if (!uni || typeof uni !== 'object')
    return
  patchSavedFile(uni)
  patchOpenDocument(uni)
}
