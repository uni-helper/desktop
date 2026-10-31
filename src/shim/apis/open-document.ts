import type { UniOptions } from '../types'
import { getBridge } from '../bridge'
import { shimChannels } from '../channels'
import { invokeUniApi } from '../result'

const DESKTOP_FILE_PREFIX = 'desktop-file://'

/**
 * Create the desktop `openDocument`. H5's `openDocument` is
 * `window.open(filePath)`, which cannot hand a file to the OS default
 * application. Paths produced by the desktop shim (`desktop-file://`) are
 * therefore opened through `shell.openPath` over IPC; every other path keeps
 * the original H5 implementation passed in by the caller (the uni-h5 export in
 * the module override, the current global in the runtime patch).
 */
export function createOpenDocument(
  openH5: ((options?: UniOptions) => unknown) | undefined,
): (options?: UniOptions) => unknown {
  return (options: UniOptions = {}) => {
    const filePath = options.filePath
    if (typeof filePath === 'string' && filePath.startsWith(DESKTOP_FILE_PREFIX)) {
      return invokeUniApi('openDocument', options, async () => {
        const bridge = getBridge()
        if (!bridge)
          throw new Error('desktop bridge unavailable; run inside the uni-desktop shell')
        await bridge.invoke(shimChannels.openDocument, { filePath, fileType: options.fileType })
        return {}
      })
    }
    return typeof openH5 === 'function' ? openH5(options) : undefined
  }
}
