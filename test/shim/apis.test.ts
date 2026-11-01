// @vitest-environment happy-dom
import type { DesktopBridge } from '../../src/shim/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenDocument, getSavedFileInfo, getSavedFileList, removeSavedFile, saveFile } from '../../src/shim/apis/index'
import { patchUni } from '../../src/shim/patch'

function createBridge(responders: Record<string, (payload: any) => any> = {}): DesktopBridge & { invoke: ReturnType<typeof vi.fn> } {
  const bridge = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      const respond = responders[channel]
      return respond ? await respond(payload) : {}
    }),
  }
  window.__UNI_DESKTOP_BRIDGE__ = bridge
  return bridge
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
    const uni: Record<string, any> = {}
    patchUni(uni)

    expect(uni.saveFile).toBe(saveFile)
    expect(uni.getSavedFileList).toBe(getSavedFileList)
    expect(uni.getSavedFileInfo).toBe(getSavedFileInfo)
    expect(uni.removeSavedFile).toBe(removeSavedFile)
    expect(typeof uni.openDocument).toBe('function')
  })

  it('does not nest the openDocument wrapper on repeated patches', () => {
    createBridge()
    const uni: Record<string, any> = {}
    patchUni(uni)
    const once = uni.openDocument
    patchUni(uni)

    expect(uni.openDocument).toBe(once)
  })
})

describe('saved files', () => {
  it('saveFile reads the temp blob and sends bytes to the main process', async () => {
    const tempFilePath = stubTempFile('png-bytes')
    const bridge = createBridge({
      'desktop:uni:saveFile': () => ({ savedFilePath: 'desktop-file://f/saved' }),
    })

    const res = await saveFile({ tempFilePath })

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

    await expect(saveFile({ tempFilePath: 'blob:test/gone' }))
      .rejects
      .toMatchObject({ errMsg: expect.stringContaining('saveFile:fail') })
  })

  it('saveFile supports the success/fail/complete callback style', async () => {
    const tempFilePath = stubTempFile('png-bytes')
    createBridge({
      'desktop:uni:saveFile': () => ({ savedFilePath: 'desktop-file://f/saved' }),
    })

    const success = vi.fn()
    const complete = vi.fn()
    const result = saveFile({ tempFilePath, success, complete })

    expect(result).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(success).toHaveBeenCalledWith(expect.objectContaining({ errMsg: 'saveFile:ok' }))
    expect(complete).toHaveBeenCalled()
  })

  it('getSavedFileList returns the file list', async () => {
    createBridge({
      'desktop:uni:getSavedFileList': () => ({
        fileList: [{ filePath: 'desktop-file://f/saved', size: 5, createTime: 0 }],
      }),
    })

    // Callback mode is not used here, so the promise overload is guaranteed.
    const res = (await getSavedFileList())!

    expect(res.fileList).toHaveLength(1)
  })

  it('getSavedFileInfo returns size and createTime', async () => {
    createBridge({
      'desktop:uni:getSavedFileInfo': () => ({ size: 7, createTime: 123 }),
    })

    const res = await getSavedFileInfo({ filePath: 'desktop-file://f/saved' })

    expect(res).toEqual({ errMsg: 'getSavedFileInfo:ok', size: 7, createTime: 123 })
  })

  it('removeSavedFile resolves with ok', async () => {
    const bridge = createBridge()

    const removed = (await removeSavedFile({ filePath: 'desktop-file://f/saved' }))!

    expect(removed.errMsg).toBe('removeSavedFile:ok')
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:uni:removeSavedFile', { filePath: 'desktop-file://f/saved' })
  })

  it('saveFile fails without tempFilePath', async () => {
    createBridge()

    await expect(saveFile()).rejects.toMatchObject({ errMsg: 'saveFile:fail tempFilePath is required' })
  })

  it('fails with a clear error when the desktop bridge is missing', async () => {
    // A plain browser build has no preload bridge; the error must say so
    // instead of failing with a TypeError on the undefined bridge.
    await expect(saveFile({ tempFilePath: stubTempFile('png-bytes') }))
      .rejects
      .toMatchObject({ errMsg: expect.stringContaining('desktop bridge unavailable') })
  })
})

describe('openDocument', () => {
  it('bridges desktop-file paths to the main process', async () => {
    const bridge = createBridge()
    const original = vi.fn()
    const openDocument = createOpenDocument(original)

    const opened = await openDocument({ filePath: 'desktop-file://f/saved' }) as { errMsg: string }

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
    const openDocument = createOpenDocument(original)

    expect(openDocument({ filePath: 'https://example.com/doc.pdf' })).toBe('h5')
    expect(original).toHaveBeenCalledWith({ filePath: 'https://example.com/doc.pdf' })
  })
})
