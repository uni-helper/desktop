export interface DesktopBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  on(channel: string, listener: (payload: any) => void): () => void
}

export interface UniResult {
  errMsg: string
  errCode?: number
  [key: string]: unknown
}

export interface UniOptions {
  success?: (res: any) => void
  fail?: (err: any) => void
  complete?: (res: any) => void
  [key: string]: unknown
}

export interface ChosenFile {
  originalPath: string
  tempPath: string
  name: string
  size: number
}

declare global {
  interface Window {
    __UNI_DESKTOP_BRIDGE__?: DesktopBridge
  }
}
