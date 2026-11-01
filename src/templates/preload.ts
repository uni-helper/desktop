import { allShimChannels, updaterEventChannel } from '@uni-helper/desktop/shim/channels'
import { contextBridge, ipcRenderer } from 'electron'

const allowedChannels = new Set<string>(allShimChannels)

contextBridge.exposeInMainWorld('__UNI_DESKTOP_BRIDGE__', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!allowedChannels.has(channel))
      return Promise.reject(new Error(`[uni-desktop] blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, payload)
  },
  onUpdaterEvent: (callback: (event: unknown) => void): void => {
    ipcRenderer.on(updaterEventChannel, (_event, payload) => callback(payload))
  },
})
