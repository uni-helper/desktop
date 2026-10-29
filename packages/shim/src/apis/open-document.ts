import type { UniOptions } from '../types'
import { getBridge } from '../bridge'
import { shimChannels } from '../channels'
import { invokeUniApi } from '../result'

const DESKTOP_FILE_PREFIX = 'desktop-file://'

/**
 * The one deliberate exception to "keep whatever uni-h5 ships": H5's
 * `openDocument` is `window.open(filePath)`, which cannot hand a file to the
 * OS default application. Paths produced by the desktop shim (`desktop-file://`)
 * are therefore opened through `shell.openPath`; every other path keeps the
 * original H5 implementation.
 */
export function patchOpenDocument(uni: Record<string, any>): void {
  const original = uni.openDocument

  uni.openDocument = (options: UniOptions = {}) => {
    const filePath = options.filePath
    if (typeof filePath === 'string' && filePath.startsWith(DESKTOP_FILE_PREFIX)) {
      return invokeUniApi('openDocument', options, async () => {
        await getBridge()!.invoke(shimChannels.openDocument, { filePath, fileType: options.fileType })
        return {}
      })
    }
    return typeof original === 'function' ? original(options) : undefined
  }
}
