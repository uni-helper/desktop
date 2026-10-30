import { getBridge } from './bridge'
import { patchUni } from './patch'

/**
 * Patch the global `uni` object with desktop-capable implementations once it
 * shows up. The shim module usually evaluates before the uni runtime, so an
 * assignment interceptor plus deferred re-checks cover every assignment order.
 */
export function installDesktopShim(): void {
  if (typeof window === 'undefined')
    return
  if (!getBridge())
    return

  const patchNow = (): void => {
    const current = (window as any).uni
    if (current)
      patchUni(current)
  }

  if ((window as any).uni) {
    patchNow()
    return
  }

  queueMicrotask(patchNow)
  setTimeout(patchNow, 0)

  const descriptor = Object.getOwnPropertyDescriptor(window, 'uni')
  if (descriptor && !descriptor.configurable)
    return

  try {
    let assigned: unknown
    Object.defineProperty(window, 'uni', {
      configurable: true,
      get: () => assigned,
      set: (value) => {
        delete (window as any).uni
        assigned = undefined
        ;(window as any).uni = value
        if (value)
          patchUni(value as Record<string, any>)
      },
    })
  }
  catch {
    patchNow()
  }
}
