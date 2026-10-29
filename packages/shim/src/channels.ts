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

export const allShimChannels: ShimChannel[] = Object.values(shimChannels)
