import { getBridge } from './bridge'
import { patchUni } from './patch'

/**
 * Patch the global `uni` object with desktop-capable implementations once it
 * shows up. The shim module usually evaluates before the uni runtime fills the
 * global, so an assignment interceptor plus deferred re-checks cover every
 * assignment order.
 *
 * The interceptor stays installed for the lifetime of the page: uni re-assigns
 * the global (e.g. when the pages-json module re-runs after HMR), and every
 * assignment must be patched again or the desktop implementations would be
 * silently lost.
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

  if (!(window as any).uni) {
    queueMicrotask(patchNow)
    setTimeout(patchNow, 0)
  }

  const descriptor = Object.getOwnPropertyDescriptor(window, 'uni')
  if (descriptor && !descriptor.configurable) {
    patchNow()
    return
  }

  try {
    // Carrying the current value into the closure keeps reads working across
    // the data-property -> accessor swap.
    let assigned: unknown = (window as any).uni
    Object.defineProperty(window, 'uni', {
      configurable: true,
      get: () => assigned,
      set: (value) => {
        assigned = value
        if (value)
          patchUni(value as Record<string, any>)
      },
    })
  }
  catch {
    // A frozen global cannot be intercepted; the deferred checks already ran
    // and the module override covers compiled builds.
  }
  patchNow()
}
