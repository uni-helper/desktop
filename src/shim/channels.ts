/**
 * IPC channels for APIs that uni-h5 does not implement. APIs that uni-h5
 * already ships (clipboard, chooseImage/Video/File, ...) are deliberately
 * absent here: the shim leaves them untouched so desktop behaviour stays
 * identical to H5.
 */
export const shimChannels = {
  saveFile: 'desktop:uni:saveFile',
  getSavedFileList: 'desktop:uni:getSavedFileList',
  getSavedFileInfo: 'desktop:uni:getSavedFileInfo',
  removeSavedFile: 'desktop:uni:removeSavedFile',
  openDocument: 'desktop:uni:openDocument',
} as const

export type ShimChannel = (typeof shimChannels)[keyof typeof shimChannels]

/**
 * Window-control channels for frameless / custom-titlebar windows. Deliberately
 * separate from `shimChannels`: the vite plugin derives the uni-h5 wrapper
 * exports from those keys, and window controls are not uni APIs.
 */
export const windowChannels = {
  minimize: 'desktop:window:minimize',
  toggleMaximize: 'desktop:window:toggleMaximize',
  close: 'desktop:window:close',
} as const

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels]

/** The preload's deny-by-default invoke allowlist: every channel the shim may call. */
export const allShimChannels: (ShimChannel | WindowChannel)[] = [
  ...Object.values(shimChannels),
  ...Object.values(windowChannels),
]
