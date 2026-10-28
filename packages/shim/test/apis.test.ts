import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopBridge } from '../src/types'
import { patchClipboard } from '../src/apis/clipboard'
import { patchChooseFile } from '../src/apis/file'
import { patchSavedFile } from '../src/apis/saved-file'

function createBridge(responders: Record<string, (payload: any) => any> = {}) {
  const bridge = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      const respond = responders[channel]
      return respond ? await respond(payload) : {}
    }),
    on: vi.fn(() => () => {}),
  }
  window.__UNI_DESKTOP_BRIDGE__ = bridge as unknown as DesktopBridge
  return bridge
}

function patchedUni(patch: (uni: Record<string, any>) => void): Record<string, any> {
  const uni: Record<string, any> = {}
  patch(uni)
  return uni
}

beforeEach(() => {
  delete window.__UNI_DESKTOP_BRIDGE__
})

describe('clipboard', () => {
  it('setClipboardData resolves in promise style', async () => {
    const bridge = createBridge()
    const uni = patchedUni(patchClipboard)

    const res = await uni.setClipboardData({ data: 'hello' })

    expect(res).toEqual({ errMsg: 'setClipboardData:ok', data: 'hello' })
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:uni:setClipboardData', { data: 'hello' })
  })

  it('setClipboardData works in callback style and returns undefined', async () => {
    createBridge()
    const uni = patchedUni(patchClipboard)
    const success = vi.fn()
    const complete = vi.fn()

    const returned = uni.setClipboardData({ data: 'x', success, complete })
    await vi.waitFor(() => expect(success).toHaveBeenCalled())

    expect(returned).toBeUndefined()
    expect(success).toHaveBeenCalledWith({ errMsg: 'setClipboardData:ok', data: 'x' })
    expect(complete).toHaveBeenCalledWith({ errMsg: 'setClipboardData:ok', data: 'x' })
  })

  it('setClipboardData rejects invalid data with fail callback', async () => {
    createBridge()
    const uni = patchedUni(patchClipboard)
    const fail = vi.fn()

    uni.setClipboardData({ data: 1, fail })
    await vi.waitFor(() => expect(fail).toHaveBeenCalled())

    expect(fail).toHaveBeenCalledWith({ errMsg: 'setClipboardData:fail data is required' })
  })

  it('getClipboardData returns clipboard content', async () => {
    createBridge({
      'desktop:uni:getClipboardData': () => ({ data: 'clip' }),
    })
    const uni = patchedUni(patchClipboard)

    const res = await uni.getClipboardData()

    expect(res).toEqual({ errMsg: 'getClipboardData:ok', data: 'clip' })
  })
})

describe('choose file', () => {
  it('chooseImage returns tempFilePaths and tempFiles', async () => {
    createBridge({
      'desktop:uni:chooseFile': () => ({
        files: [
          { originalPath: '/tmp/a.png', tempPath: 'desktop-file://f/a', name: 'a.png', size: 1 },
          { originalPath: '/tmp/b.png', tempPath: 'desktop-file://f/b', name: 'b.png', size: 2 },
        ],
      }),
    })
    const uni = patchedUni(patchChooseFile)

    const res = await uni.chooseImage({ count: 2 })

    expect(res.errMsg).toBe('chooseImage:ok')
    expect(res.tempFilePaths).toEqual(['desktop-file://f/a', 'desktop-file://f/b'])
    expect(res.tempFiles[0]).toMatchObject({ path: 'desktop-file://f/a', size: 1, fileType: 'image' })
  })

  it('chooseVideo returns a single tempFilePath', async () => {
    createBridge({
      'desktop:uni:chooseFile': () => ({
        files: [{ originalPath: '/tmp/v.mp4', tempPath: 'desktop-file://f/v', name: 'v.mp4', size: 3 }],
      }),
    })
    const uni = patchedUni(patchChooseFile)

    const res = await uni.chooseVideo()

    expect(res).toMatchObject({ errMsg: 'chooseVideo:ok', tempFilePath: 'desktop-file://f/v', size: 3 })
  })

  it('normalizes extensions and forwards kind and count', async () => {
    const bridge = createBridge({
      'desktop:uni:chooseFile': () => ({ files: [] }),
    })
    const uni = patchedUni(patchChooseFile)

    await uni.chooseFile({ count: 3, extension: ['.pdf', 'DOC'] })

    expect(bridge.invoke).toHaveBeenCalledWith('desktop:uni:chooseFile', {
      kind: 'file',
      count: 3,
      extensions: ['pdf', 'doc'],
    })
  })

  it('reports cancel as a uni fail result', async () => {
    createBridge({
      'desktop:uni:chooseFile': () => {
        throw new Error('cancel')
      },
    })
    const uni = patchedUni(patchChooseFile)
    const fail = vi.fn()

    uni.chooseImage({ fail })
    await vi.waitFor(() => expect(fail).toHaveBeenCalled())

    expect(fail).toHaveBeenCalledWith({ errMsg: 'chooseImage:fail cancel' })
  })
})

describe('saved files', () => {
  it('saveFile returns savedFilePath', async () => {
    createBridge({
      'desktop:uni:saveFile': () => ({ savedFilePath: 'desktop-file://f/saved' }),
    })
    const uni = patchedUni(patchSavedFile)

    const res = await uni.saveFile({ tempFilePath: 'desktop-file://f/a' })

    expect(res).toEqual({ errMsg: 'saveFile:ok', savedFilePath: 'desktop-file://f/saved' })
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

  it('removeSavedFile and openDocument resolve with ok', async () => {
    const bridge = createBridge()
    const uni = patchedUni(patchSavedFile)

    const removed = await uni.removeSavedFile({ filePath: 'desktop-file://f/saved' })
    const opened = await uni.openDocument({ filePath: 'desktop-file://f/saved' })

    expect(removed.errMsg).toBe('removeSavedFile:ok')
    expect(opened.errMsg).toBe('openDocument:ok')
    expect(bridge.invoke).toHaveBeenCalledWith('desktop:uni:removeSavedFile', { filePath: 'desktop-file://f/saved' })
  })

  it('saveFile fails without tempFilePath', async () => {
    createBridge()
    const uni = patchedUni(patchSavedFile)

    await expect(uni.saveFile()).rejects.toMatchObject({ errMsg: 'saveFile:fail tempFilePath is required' })
  })
})
