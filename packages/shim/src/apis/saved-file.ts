import { getBridge } from '../bridge'
import { shimChannels } from '../channels'
import { invokeUniApi } from '../result'
import type { UniOptions } from '../types'

/**
 * Read a renderer-side temp path into base64. uni-h5's `chooseImage` /
 * `chooseVideo` / `chooseFile` return `blob:` URLs, which the main process
 * cannot resolve, so the bytes are fetched here and sent over IPC.
 */
async function readAsBase64(url: string): Promise<{ base64: string, mime?: string }> {
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
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
  return { base64: btoa(binary), mime: contentType || undefined }
}

export function patchSavedFile(uni: Record<string, any>): void {
  uni.saveFile = (options: UniOptions = {}) => invokeUniApi(
    'saveFile',
    options,
    async () => {
      if (typeof options.tempFilePath !== 'string')
        throw new Error('tempFilePath is required')
      const { base64, mime } = await readAsBase64(options.tempFilePath)
      return await getBridge()!.invoke(shimChannels.saveFile, { base64, mime }) as { savedFilePath: string }
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
