import { allShimChannels } from '@uni-helper/desktop-shim/channels'
import { contextBridge, ipcRenderer } from 'electron'

const allowedChannels = new Set<string>(allShimChannels)

type Listener = (payload: unknown) => void

contextBridge.exposeInMainWorld('__UNI_DESKTOP_BRIDGE__', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!allowedChannels.has(channel))
      return Promise.reject(new Error(`[uni-desktop] blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, payload)
  },
  on: (channel: string, listener: Listener): (() => void) => {
    if (!allowedChannels.has(channel))
      return () => {}
    const wrapped = (_event: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
})
