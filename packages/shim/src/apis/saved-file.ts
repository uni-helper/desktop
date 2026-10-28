import { getBridge } from '../bridge'
import { shimChannels } from '../channels'
import { invokeUniApi } from '../result'
import type { UniOptions } from '../types'

export function patchSavedFile(uni: Record<string, any>): void {
  uni.saveFile = (options: UniOptions = {}) => invokeUniApi(
    'saveFile',
    options,
    async () => {
      if (typeof options.tempFilePath !== 'string')
        throw new Error('tempFilePath is required')
      return await getBridge()!.invoke(shimChannels.saveFile, {
        tempFilePath: options.tempFilePath,
      }) as { savedFilePath: string }
    },
  )

  uni.getSavedFileList = (options: UniOptions = {}) => invokeUniApi(
    'getSavedFileList',
    options,
    async () => await getBridge()!.invoke(shimChannels.getSavedFileList) as { fileList: any[] },
  )

  uni.removeSavedFile = (options: UniOptions = {}) => invokeUniApi(
    'removeSavedFile',
    options,
    async () => {
      if (typeof options.filePath !== 'string')
        throw new Error('filePath is required')
      await getBridge()!.invoke(shimChannels.removeSavedFile, { filePath: options.filePath })
      return {}
    },
  )

  uni.openDocument = (options: UniOptions = {}) => invokeUniApi(
    'openDocument',
    options,
    async () => {
      if (typeof options.filePath !== 'string')
        throw new Error('filePath is required')
      await getBridge()!.invoke(shimChannels.openDocument, {
        filePath: options.filePath,
        fileType: options.fileType,
      })
      return {}
    },
  )
}
