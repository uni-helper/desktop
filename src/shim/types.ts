export interface DesktopBridge {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
  /** Push channel for main→renderer events; added by the desktop preload only. */
  onUpdaterEvent?: (callback: (event: unknown) => void) => void
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

declare global {
  interface Window {
    __UNI_DESKTOP_BRIDGE__?: DesktopBridge
  }
}
