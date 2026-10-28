import { patchClipboard } from './apis/clipboard'
import { patchChooseFile } from './apis/file'
import { patchSavedFile } from './apis/saved-file'

export function patchUni(uni: Record<string, any>): void {
  if (!uni || typeof uni !== 'object')
    return
  patchClipboard(uni)
  patchChooseFile(uni)
  patchSavedFile(uni)
}
