// @vitest-environment happy-dom
import type { DesktopBridge } from '../../src/shim/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function createBridge(): DesktopBridge & { invoke: ReturnType<typeof vi.fn> } {
  return {
    invoke: vi.fn(async () => ({})),
    on: vi.fn(() => () => {}),
  } as any
}

function flushAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  delete (window as any).uni
  delete window.__UNI_DESKTOP_BRIDGE__
})

afterEach(() => {
  delete (window as any).uni
  delete window.__UNI_DESKTOP_BRIDGE__
})

describe('installDesktopShim', () => {
  it('does nothing without a bridge', async () => {
    const { installDesktopShim } = await import('../../src/shim/install')
    installDesktopShim()

    const uni = { setClipboardData: () => 'native' }
    ;(window as any).uni = uni
    await flushAsync()

    expect(uni.setClipboardData()).toBe('native')
  })

  it('patches an existing uni object immediately', async () => {
    const bridge = createBridge()
    window.__UNI_DESKTOP_BRIDGE__ = bridge
    const uni: Record<string, any> = {}
    ;(window as any).uni = uni

    const { installDesktopShim } = await import('../../src/shim/install')
    installDesktopShim()

    expect(typeof uni.saveFile).toBe('function')
    expect(typeof uni.getSavedFileList).toBe('function')
  })

  it('patches uni assigned after install via the assignment interceptor', async () => {
    const bridge = createBridge()
    window.__UNI_DESKTOP_BRIDGE__ = bridge

    const { installDesktopShim } = await import('../../src/shim/install')
    installDesktopShim()

    const uni: Record<string, any> = {}
    ;(window as any).uni = uni

    expect(typeof uni.saveFile).toBe('function')
    expect(uni).toBe((window as any).uni)
  })

  it('keeps patching when uni is replaced later', async () => {
    const bridge = createBridge()
    window.__UNI_DESKTOP_BRIDGE__ = bridge

    const { installDesktopShim } = await import('../../src/shim/install')
    installDesktopShim()

    ;(window as any).uni = { saveFile: () => 'uni-h5' }
    // uni re-assigns the global at runtime (e.g. the pages-json module after
    // HMR); the replacement must be patched too or the shim silently dies.
    const replacement: Record<string, any> = {}
    ;(window as any).uni = replacement

    expect(typeof replacement.saveFile).toBe('function')
  })

  it('patches uni assigned asynchronously via the deferred fallback', async () => {
    const bridge = createBridge()
    window.__UNI_DESKTOP_BRIDGE__ = bridge

    const { installDesktopShim } = await import('../../src/shim/install')
    installDesktopShim()

    await flushAsync()

    const uni: Record<string, any> = {}
    ;(window as any).uni = uni
    await flushAsync()

    expect(typeof uni.saveFile).toBe('function')
  })

  it('ignores non-object uni values', async () => {
    const bridge = createBridge()
    window.__UNI_DESKTOP_BRIDGE__ = bridge

    const { installDesktopShim } = await import('../../src/shim/install')
    installDesktopShim()
    await flushAsync()

    ;(window as any).uni = 42
    await flushAsync()

    expect((window as any).uni).toBe(42)
  })
})
