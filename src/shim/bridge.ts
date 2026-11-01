import type { DesktopBridge } from './types'

export function getBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined')
    return undefined
  return window.__UNI_DESKTOP_BRIDGE__
}

/** The bridge every desktop API call goes through; absent outside the shell. */
export function getBridgeOrThrow(): DesktopBridge {
  const bridge = getBridge()
  if (!bridge)
    throw new Error('desktop bridge unavailable; run inside the uni-desktop shell')
  return bridge
}
