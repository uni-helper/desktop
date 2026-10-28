import { getBridge } from '../bridge'
import { shimChannels } from '../channels'
import { invokeUniApi } from '../result'
import type { UniOptions } from '../types'

export function patchClipboard(uni: Record<string, any>): void {
  uni.setClipboardData = (options: UniOptions = {}) => invokeUniApi(
    'setClipboardData',
    options,
    async () => {
      if (typeof options.data !== 'string')
        throw new Error('data is required')
      await getBridge()!.invoke(shimChannels.setClipboardData, { data: options.data })
      return { data: options.data }
    },
  )

  uni.getClipboardData = (options: UniOptions = {}) => invokeUniApi(
    'getClipboardData',
    options,
    async () => await getBridge()!.invoke(shimChannels.getClipboardData) as { data: string },
  )
}
