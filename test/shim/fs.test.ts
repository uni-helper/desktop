// @vitest-environment happy-dom
import type { DesktopBridge } from '../../src/shim/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFileSystemManager } from '../../src/shim/apis/fs'

function createBridge(responders: Record<string, (payload: any) => any> = {}) {
  const invoke = vi.fn(async (channel: string, payload?: unknown) => {
    const respond = responders[channel]
    return respond ? await respond(payload) : {}
  })
  const bridge: DesktopBridge = { invoke }
  window.__UNI_DESKTOP_BRIDGE__ = bridge
  return { invoke }
}

beforeEach(() => {
  delete window.__UNI_DESKTOP_BRIDGE__
})

describe('getFileSystemManager prototype', () => {
  it('readFile returns decoded text with the utf-8 encoding', async () => {
    createBridge({
      'desktop:uni:fs:readFile': () => ({ data: new TextEncoder().encode('file-content').buffer }),
    })
    const manager = getFileSystemManager()

    const res = await manager.readFile({ filePath: 'desktop-file://f/a.txt', encoding: 'utf-8' })

    expect(res).toEqual({ errMsg: 'readFile:ok', data: 'file-content' })
  })

  it('readFile returns raw bytes without an encoding', async () => {
    const bytes = new TextEncoder().encode('raw')
    createBridge({
      'desktop:uni:fs:readFile': () => ({ data: bytes.buffer }),
    })
    const manager = getFileSystemManager()

    const res = await manager.readFile({ filePath: 'desktop-file://f/a.bin' })

    expect(new Uint8Array(res!.data as ArrayBuffer)).toEqual(bytes)
  })

  it('writeFile sends string data as utf-8 bytes', async () => {
    const bridge = createBridge()
    const manager = getFileSystemManager()

    const res = await manager.writeFile({ filePath: 'desktop-file://f/a.txt', data: 'text-data' })

    expect(res).toEqual({ errMsg: 'writeFile:ok' })
    const payload = bridge.invoke.mock.calls[0]?.[1] as { filePath: string, data: Uint8Array }
    expect(payload.filePath).toBe('desktop-file://f/a.txt')
    expect(new TextDecoder().decode(payload.data)).toBe('text-data')
  })

  it('rejects unsupported encodings and missing paths without touching the bridge', async () => {
    createBridge()
    const manager = getFileSystemManager()

    await expect(manager.readFile({ filePath: 'desktop-file://f/a.txt', encoding: 'base64' }))
      .rejects
      .toMatchObject({ errMsg: expect.stringContaining('readFile:fail') })
    await expect(manager.readFile({} as any))
      .rejects
      .toMatchObject({ errMsg: 'readFile:fail filePath is required' })
    await expect(manager.writeFile({ data: 'x' } as any))
      .rejects
      .toMatchObject({ errMsg: 'writeFile:fail filePath is required' })
  })

  it('fails with a uni-style error outside the desktop shell', async () => {
    const manager = getFileSystemManager()

    await expect(manager.readFile({ filePath: 'desktop-file://f/a.txt' }))
      .rejects
      .toMatchObject({ errMsg: expect.stringContaining('desktop bridge unavailable') })
  })

  it('supports the success/fail callback style', async () => {
    createBridge()
    const manager = getFileSystemManager()
    const success = vi.fn()
    const fail = vi.fn()

    const result = manager.writeFile({ filePath: 'desktop-file://f/a.txt', data: 'x', success, fail })

    expect(result).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(success).toHaveBeenCalledWith(expect.objectContaining({ errMsg: 'writeFile:ok' }))
    expect(fail).not.toHaveBeenCalled()
  })
})
