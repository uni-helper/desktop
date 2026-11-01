import { getBridgeOrThrow } from '../bridge'
import { fsChannels } from '../channels'
import { invokeUniApi } from '../result'

/**
 * `uni.getFileSystemManager()` prototype subset (readFile/writeFile), over the
 * managed saved directory. See docs/design/fs-manager.md for the root policy,
 * limits and the deferrals; this module follows the saved-file pattern and
 * ships the bytes over IPC instead of paths.
 */

/** Encoding conversions happen renderer-side from the raw bytes. */
function decode(bytes: Uint8Array, encoding: string | undefined): string | ArrayBuffer {
  // uni spec: without an encoding readFile resolves with the raw ArrayBuffer.
  if (!encoding)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  if (encoding === 'utf-8' || encoding === 'utf8')
    return new TextDecoder('utf-8').decode(bytes)
  throw new Error(`encoding "${encoding}" is not supported by the prototype`)
}

/** Desktop `getFileSystemManager().readFile`: read a file inside the managed directory. */
export function fsReadFile(options: any = {}): Promise<{ data: string | ArrayBuffer }> | undefined {
  return invokeUniApi(
    'readFile',
    options,
    async () => {
      if (typeof options.filePath !== 'string')
        throw new Error('filePath is required')
      const res = await getBridgeOrThrow().invoke(fsChannels.readFile, { filePath: options.filePath }) as { data: ArrayBuffer }
      return { data: decode(new Uint8Array(res.data), options.encoding) }
    },
  )
}

/** Desktop `getFileSystemManager()`: the prototype manager (readFile/writeFile only). */
export function getFileSystemManager(): {
  readFile: typeof fsReadFile
  writeFile: typeof fsWriteFile
} {
  return {
    readFile: fsReadFile,
    writeFile: fsWriteFile,
  }
}

/** Desktop `getFileSystemManager().writeFile`: overwrite a file inside the managed directory. */
export function fsWriteFile(options: any = {}): Promise<{ errMsg: string }> | undefined {
  return invokeUniApi(
    'writeFile',
    options,
    async () => {
      if (typeof options.filePath !== 'string')
        throw new Error('filePath is required')
      const data = options.data
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer))
        throw new TypeError('data must be a string or ArrayBuffer')
      await getBridgeOrThrow().invoke(fsChannels.writeFile, { filePath: options.filePath, data: bytes })
      return {}
    },
  )
}
