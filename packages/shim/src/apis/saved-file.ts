import type { UniOptions } from '../types'
import { getBridge } from '../bridge'
import { shimChannels } from '../channels'
import { invokeUniApi } from '../result'

/**
 * Read a renderer-side temp path into raw bytes. uni-h5's `chooseImage` /
 * `chooseVideo` / `chooseFile` return `blob:` URLs, which the main process
 * cannot resolve, so the bytes are fetched here and sent over IPC. Sending
 * bytes instead of a base64 string keeps peak memory close to the file size
 * instead of tripling it.
 */
async function readAsBytes(url: string): Promise<{ bytes: Uint8Array, mime?: string }> {
  let response: Response
  try {
    response = await fetch(url)
  }
  catch {
    throw new Error(`tempFilePath is not readable (${url}); use a fresh path from uni.chooseImage/chooseVideo/chooseFile`)
  }
  if (!response.ok)
    throw new Error(`tempFilePath is not readable (${url}); use a fresh path from uni.chooseImage/chooseVideo/chooseFile`)

  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
  return { bytes, mime: contentType || undefined }
}

export function patchSavedFile(uni: Record<string, any>): void {
  uni.saveFile = (options: UniOptions = {}) => invokeUniApi(
    'saveFile',
    options,
    async () => {
      if (typeof options.tempFilePath !== 'string')
        throw new Error('tempFilePath is required')
      const { bytes, mime } = await readAsBytes(options.tempFilePath)
      return await getBridge()!.invoke(shimChannels.saveFile, { bytes, mime }) as { savedFilePath: string }
    },
  )

  uni.getSavedFileList = (options: UniOptions = {}) => invokeUniApi(
    'getSavedFileList',
    options,
    async () => await getBridge()!.invoke(shimChannels.getSavedFileList) as { fileList: any[] },
  )

  uni.getSavedFileInfo = (options: UniOptions = {}) => invokeUniApi(
    'getSavedFileInfo',
    options,
    async () => {
      if (typeof options.filePath !== 'string')
        throw new Error('filePath is required')
      return await getBridge()!.invoke(shimChannels.getSavedFileInfo, { filePath: options.filePath }) as { size: number, createTime: number }
    },
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
}
