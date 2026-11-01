// @vitest-environment happy-dom
import type { DesktopBridge } from '../../src/shim/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUpdateManager } from '../../src/shim/apis/update-manager'

let lastStateEvent: unknown

function createBridge(overrides: Partial<DesktopBridge> = {}) {
  let hook: ((event: unknown) => void) | undefined
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'desktop:uni:getUpdateManager')
      return { event: lastStateEvent }
    return {}
  })
  const bridge: DesktopBridge = {
    invoke,
    onUpdaterEvent: (callback: (event: unknown) => void) => {
      hook = callback
    },
    ...overrides,
  }
  window.__UNI_DESKTOP_BRIDGE__ = bridge
  return { invoke, deliver: (event: unknown) => hook?.(event) }
}

beforeEach(() => {
  lastStateEvent = undefined
  delete window.__UNI_DESKTOP_BRIDGE__
})

describe('getUpdateManager', () => {
  it('returns undefined without a bridge', () => {
    expect(getUpdateManager()).toBeUndefined()
  })

  it('delivers pushed events to the registered callbacks', async () => {
    const bridge = createBridge()
    const manager = getUpdateManager()!
    const onCheck = vi.fn()
    const onReady = vi.fn()
    const onFailed = vi.fn()
    manager.onCheckForUpdate(onCheck)
    manager.onUpdateReady(onReady)
    manager.onUpdateFailed(onFailed)

    bridge.deliver({ type: 'checkForUpdate' })
    bridge.deliver({ type: 'updateReady', version: '2.0.0' })
    bridge.deliver({ type: 'updateFailed', message: 'network down' })
    // Events without a uni-spec listener are stored but not delivered.
    bridge.deliver({ type: 'updateAvailable' })

    expect(onCheck).toHaveBeenCalledWith({ errMsg: 'ok' })
    expect(onReady).toHaveBeenCalledWith({ errMsg: 'ok', version: '2.0.0' })
    expect(onFailed).toHaveBeenCalledWith({ errMsg: 'network down' })
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it('pulls the last event on late subscribe via the state channel', async () => {
    lastStateEvent = { type: 'updateReady', version: '3.0.0' }
    createBridge()
    const manager = getUpdateManager()!
    const onReady = vi.fn()
    manager.onUpdateReady(onReady)

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith({ errMsg: 'ok', version: '3.0.0' }))
  })

  it('applyUpdate invokes the updater channel and surfaces uni-style failures', async () => {
    const bridge = createBridge()
    const manager = getUpdateManager()!

    await expect(manager.applyUpdate()).resolves.toMatchObject({ errMsg: 'applyUpdate:ok' })
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:uni:applyUpdate')

    bridge.invoke.mockRejectedValueOnce(new Error('no downloaded update'))
    await expect(manager.applyUpdate()).rejects.toMatchObject({ errMsg: 'applyUpdate:fail no downloaded update' })
  })
})
