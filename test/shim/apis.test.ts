// @vitest-environment happy-dom
import type { DesktopBridge } from '../../src/shim/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { patchOpenDocument } from '../../src/shim/apis/open-document'
import { patchSavedFile } from '../../src/shim/apis/saved-file'
import { patchUni } from '../../src/shim/patch'

function createBridge(responders: Record<string, (payload: any) => any> = {}): DesktopBridge & { invoke: ReturnType<typeof vi.fn> } {
  const bridge = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      const respond = responders[channel]
      return respond ? await respond(payload) : {}
    }),
    on: vi.fn(() => () => {}),
  }
  window.__UNI_DESKTOP_BRIDGE__ = bridge
  return bridge
}

function patchedUni(patch: (uni: Record<string, any>) => void): Record<string, any> {
  const uni: Record<string, any> = {}
  patch(uni)
  return uni
}

/** Build a `blob:`-like URL whose bytes are readable through `fetch`. */
function stubTempFile(content: string, type = 'image/png'): string {
  const url = `blob:test/${Math.random().toString(36).slice(2)}`
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input !== url)
      return new Response(null, { status: 404 })
    return new Response(content, { headers: { 'content-type': type } })
  }))
  return url
}

beforeEach(() => {
  delete window.__UNI_DESKTOP_BRIDGE__
  vi.unstubAllGlobals()
})

describe('patchUni scope', () => {
  it('leaves APIs that uni-h5 implements untouched', () => {
    createBridge()
    const original = {
      setClipboardData: vi.fn(),
      getClipboardData: vi.fn(),
      chooseImage: vi.fn(),
      chooseVideo: vi.fn(),
      chooseFile: vi.fn(),
      openDocument: vi.fn(),
    }
    const uni = { ...original }
    patchUni(uni)

    expect(uni.setClipboardData).toBe(original.setClipboardData)
    expect(uni.getClipboardData).toBe(original.getClipboardData)
    expect(uni.chooseImage).toBe(original.chooseImage)
    expect(uni.chooseVideo).toBe(original.chooseVideo)
    expect(uni.chooseFile).toBe(original.chooseFile)
  })

  it('patches only the APIs uni-h5 does not implement', () => {
    createBridge()
    const uni = patchedUni(patchUni)

    expect(typeof uni.saveFile).toBe('function')
    expect(typeof uni.getSavedFileList).toBe('function')
    expect(typeof uni.getSavedFileInfo).toBe('function')
    expect(typeof uni.removeSavedFile).toBe('function')
  })
})

describe('saved files', () => {
  it('saveFile reads the temp blob and sends bytes to the main process', async () => {
    const tempFilePath = stubTempFile('png-bytes')
    const bridge = createBridge({
      'desktop:uni:saveFile': () => ({ savedFilePath: 'desktop-file://f/saved' }),
    })
    const uni = patchedUni(patchSavedFile)

    const res = await uni.saveFile({ tempFilePath })

    expect(res).toEqual({ errMsg: 'saveFile:ok', savedFilePath: 'desktop-file://f/saved' })
    // Bytes are transferred as-is; a base64 string would triple peak memory for
    // large files.
    const payload = bridge.invoke.mock.calls[0]?.[1] as { bytes: Uint8Array, mime: string }
    expect(payload.mime).toBe('image/png')
    expect(payload.bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(payload.bytes)).toBe('png-bytes')
  })

  it('saveFile reports an unreadable temp path', async () => {
    createBridge()
    const uni = patchedUni(patchSavedFile)

    await expect(uni.saveFile({ tempFilePath: 'blob:test/gone' }))
      .rejects
      .toMatchObject({ errMsg: expect.stringContaining('saveFile:fail') })
  })

  it('getSavedFileList returns the file list', async () => {
    createBridge({
      'desktop:uni:getSavedFileList': () => ({
        fileList: [{ filePath: 'desktop-file://f/saved', size: 5, createTime: 0 }],
      }),
    })
    const uni = patchedUni(patchSavedFile)

    const res = await uni.getSavedFileList()

    expect(res.fileList).toHaveLength(1)
  })

  it('getSavedFileInfo returns size and createTime', async () => {
    createBridge({
      'desktop:uni:getSavedFileInfo': () => ({ size: 7, createTime: 123 }),
    })
    const uni = patchedUni(patchSavedFile)

    const res = await uni.getSavedFileInfo({ filePath: 'desktop-file://f/saved' })

    expect(res).toEqual({ errMsg: 'getSavedFileInfo:ok', size: 7, createTime: 123 })
  })

  it('removeSavedFile resolves with ok', async () => {
    const bridge = createBridge()
    const uni = patchedUni(patchSavedFile)

    const removed = await uni.removeSavedFile({ filePath: 'desktop-file://f/saved' })

    expect(removed.errMsg).toBe('removeSavedFile:ok')
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:uni:removeSavedFile', { filePath: 'desktop-file://f/saved' })
  })

  it('saveFile fails without tempFilePath', async () => {
    createBridge()
    const uni = patchedUni(patchSavedFile)

    await expect(uni.saveFile()).rejects.toMatchObject({ errMsg: 'saveFile:fail tempFilePath is required' })
  })
})

describe('openDocument', () => {
  it('bridges desktop-file paths to the main process', async () => {
    const bridge = createBridge()
    const original = vi.fn()
    const uni: Record<string, any> = { openDocument: original }
    patchOpenDocument(uni)

    const opened = await uni.openDocument({ filePath: 'desktop-file://f/saved' })

    expect(opened.errMsg).toBe('openDocument:ok')
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:uni:openDocument', {
      filePath: 'desktop-file://f/saved',
      fileType: undefined,
    })
    expect(original).not.toHaveBeenCalled()
  })

  it('delegates every other path to the uni-h5 implementation', () => {
    createBridge()
    const original = vi.fn(() => 'h5')
    const uni: Record<string, any> = { openDocument: original }
    patchOpenDocument(uni)

    expect(uni.openDocument({ filePath: 'https://example.com/doc.pdf' })).toBe('h5')
    expect(original).toHaveBeenCalledWith({ filePath: 'https://example.com/doc.pdf' })
  })
})
