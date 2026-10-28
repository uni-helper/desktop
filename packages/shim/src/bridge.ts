import type { DesktopBridge } from './types'

export function getBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined')
    return undefined
  return window.__UNI_DESKTOP_BRIDGE__
}
