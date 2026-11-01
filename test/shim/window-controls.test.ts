// @vitest-environment happy-dom
import type { DesktopBridge } from '../../src/shim/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopWindow } from '../../src/shim/apis/window-controls'

function createBridge(): DesktopBridge & { invoke: ReturnType<typeof vi.fn> } {
  const bridge = {
    invoke: vi.fn(async () => ({})),
  }
  window.__UNI_DESKTOP_BRIDGE__ = bridge
  return bridge as any
}

beforeEach(() => {
  delete window.__UNI_DESKTOP_BRIDGE__
})

describe('desktopWindow', () => {
  it('invokes the window channels through the bridge', async () => {
    const bridge = createBridge()

    desktopWindow.minimize()
    desktopWindow.toggleMaximize()
    desktopWindow.close()

    expect(bridge.invoke).toHaveBeenCalledWith('desktop:window:minimize')
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:window:toggleMaximize')
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:window:close')
  })

  it('no-ops without a bridge', () => {
    expect(() => {
      desktopWindow.minimize()
      desktopWindow.toggleMaximize()
      desktopWindow.close()
    }).not.toThrow()
  })
})
