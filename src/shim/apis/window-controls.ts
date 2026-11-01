import { getBridge } from '../bridge'
import { windowChannels } from '../channels'

/**
 * Window controls for frameless / custom-titlebar desktop windows. Not uni
 * APIs: call them behind `#ifdef DESKTOP`, e.g.
 * `import { desktopWindow } from '@uni-helper/desktop/shim'`. No-op outside
 * the desktop shell (pure browser), like the rest of the shim.
 */
export const desktopWindow = {
  minimize: (): void => { void getBridge()?.invoke(windowChannels.minimize) },
  toggleMaximize: (): void => { void getBridge()?.invoke(windowChannels.toggleMaximize) },
  close: (): void => { void getBridge()?.invoke(windowChannels.close) },
}
