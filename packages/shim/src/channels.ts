export const shimChannels = {
  setClipboardData: 'desktop:uni:setClipboardData',
  getClipboardData: 'desktop:uni:getClipboardData',
  chooseFile: 'desktop:uni:chooseFile',
  saveFile: 'desktop:uni:saveFile',
  getSavedFileList: 'desktop:uni:getSavedFileList',
  removeSavedFile: 'desktop:uni:removeSavedFile',
  openDocument: 'desktop:uni:openDocument',
} as const

export type ShimChannel = (typeof shimChannels)[keyof typeof shimChannels]

export const allShimChannels: ShimChannel[] = Object.values(shimChannels)
