import type { UpdaterEvent } from '../channels'
import { getBridge } from '../bridge'
import { shimChannels, updaterChannels } from '../channels'
import { invokeUniApi } from '../result'

/**
 * Desktop `uni.getUpdateManager()`: uni-spec shape over the electron-updater
 * bridge. Pure-browser opens have no bridge: the factory returns undefined
 * and `patchUni` skips it, matching uni-h5's missing implementation.
 */
export function getUpdateManager(): {
  onCheckForUpdate: (callback: (res: { errMsg: string }) => void) => void
  onUpdateReady: (callback: (res: { errMsg: string, version?: string }) => void) => void
  onUpdateFailed: (callback: (res: { errMsg: string }) => void) => void
  applyUpdate: () => Promise<unknown> | undefined
} | undefined {
  const bridge = getBridge()
  if (!bridge)
    return undefined

  const listeners: Record<'checkForUpdate' | 'updateReady' | 'updateFailed', ((res: any) => void)[]> = {
    checkForUpdate: [],
    updateReady: [],
    updateFailed: [],
  }
  const deliver = (event: UpdaterEvent): void => {
    if (event.type === 'checkForUpdate')
      listeners.checkForUpdate.forEach(callback => callback({ errMsg: 'ok' }))
    else if (event.type === 'updateReady')
      listeners.updateReady.forEach(callback => callback({ errMsg: 'ok', version: event.version }))
    else if (event.type === 'updateFailed')
      listeners.updateFailed.forEach(callback => callback({ errMsg: event.message }))
  }

  // Register through the preload hook, then pull the last event (late subscribe).
  bridge.onUpdaterEvent?.((event: unknown) => deliver(event as UpdaterEvent))
  void bridge.invoke(shimChannels.getUpdateManager).then((res) => {
    const event = (res as { event?: UpdaterEvent })?.event
    if (event)
      deliver(event)
  })

  return {
    onCheckForUpdate: (callback) => { listeners.checkForUpdate.push(callback) },
    onUpdateReady: (callback) => { listeners.updateReady.push(callback) },
    onUpdateFailed: (callback) => { listeners.updateFailed.push(callback) },
    applyUpdate: () => invokeUniApi('applyUpdate', {}, async () => {
      await bridge.invoke(updaterChannels.applyUpdate)
      return {}
    }),
  }
}
