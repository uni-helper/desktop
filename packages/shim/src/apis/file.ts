import { getBridge } from '../bridge'
import { shimChannels } from '../channels'
import { invokeUniApi } from '../result'
import type { ChosenFile, UniOptions } from '../types'

type ChooseKind = 'image' | 'video' | 'file'

function normalizeExtensions(extensions: unknown): string[] | undefined {
  if (!Array.isArray(extensions))
    return undefined
  const normalized = extensions
    .filter(ext => typeof ext === 'string')
    .map(ext => ext.replace(/^\./, '').toLowerCase())
    .filter(Boolean)
  return normalized.length > 0 ? normalized : undefined
}

function choose(api: string, kind: ChooseKind, single: boolean) {
  return (options: UniOptions = {}) => invokeUniApi(
    api,
    options,
    async () => {
      const count = single ? 1 : Math.max(1, Number(options.count) || 9)
      const res = await getBridge()!.invoke(shimChannels.chooseFile, {
        kind,
        count,
        extensions: normalizeExtensions(options.extension),
      }) as { files: ChosenFile[] }
      const files = res.files

      if (kind === 'video') {
        const file = files[0]
        return {
          tempFilePath: file.tempPath,
          size: file.size,
          name: file.name,
        }
      }

      const fileType = kind === 'image' ? 'image' : kind
      return {
        tempFilePaths: files.map(file => file.tempPath),
        tempFiles: files.map(file => ({
          path: file.tempPath,
          size: file.size,
          name: file.name,
          fileType,
        })),
      }
    },
  )
}

export function patchChooseFile(uni: Record<string, any>): void {
  uni.chooseImage = choose('chooseImage', 'image', false)
  uni.chooseVideo = choose('chooseVideo', 'video', true)
  uni.chooseFile = choose('chooseFile', 'file', false)
}
