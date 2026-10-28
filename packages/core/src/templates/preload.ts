import { contextBridge, ipcRenderer } from 'electron'
import { allShimChannels } from '@uni-helper/desktop-shim'

const allowedChannels = new Set<string>(allShimChannels)

contextBridge.exposeInMainWorld('__UNI_DESKTOP_BRIDGE__', {
  invoke: (channel: string, payload?: unknown) => {
    if (!allowedChannels.has(channel))
      return Promise.reject(new Error(`[uni-desktop] blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, payload)
  },
  on: (channel: string, listener: (payload: any) => void) => {
    if (!allowedChannels.has(channel))
      return () => {}
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on(channel, wrapped as any)
    return () => {
      ipcRenderer.removeListener(channel, wrapped as any)
    }
  },
})
