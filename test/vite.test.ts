import type { Plugin } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { uniDesktop } from '../src/vite/index'

const UNI_H5_ID = '@dcloudio/uni-h5'

function plugin(): Plugin {
  return uniDesktop()
}

/** Vite wraps hooks in `{ handler, order }` objects; get the callable. */
function hook<T extends (this: any, ...args: any[]) => any>(value: T | { handler: T }): T {
  return typeof value === 'function' ? value : value.handler
}

function resolveId(instance: Plugin, context: unknown, ...args: any[]): any {
  return (hook(instance.resolveId!) as (...a: any[]) => any).call(context, ...args)
}

function load(instance: Plugin, id: string): any {
  return (hook(instance.load!) as (...a: any[]) => any).call({} as any, id)
}

describe('uniDesktop vite plugin', () => {
  it('orders its resolver ahead of uni\'s own pre-group resolver', () => {
    const instance = plugin()

    // uni resolves `@dcloudio/uni-h5` to an absolute path in its own pre-group
    // resolveId; only a hook-level `order: 'pre'` runs ahead of it regardless
    // of the plugin's position in the user's `plugins` array.
    expect(instance.resolveId).toMatchObject({ order: 'pre' })
  })

  it('redirects uni-h5 imports to the desktop wrapper', async () => {
    const instance = plugin()

    const resolved = await resolveId(instance, {}, UNI_H5_ID, '/project/src/main.ts', {})

    expect(resolved).toBe('\0uni-desktop/uni-h5')
  })

  it('resolves the real uni-h5 module for the wrapper itself', async () => {
    const instance = plugin()
    const resolve = vi.fn(async () => ({ id: '/real/uni-h5.es.js' }))

    const resolved = await resolveId(instance, { resolve }, UNI_H5_ID, '\0uni-desktop/uni-h5', {})

    // Without skipSelf the wrapper would import itself and loop forever.
    expect(resolve).toHaveBeenCalledWith(UNI_H5_ID, '\0uni-desktop/uni-h5', expect.objectContaining({ skipSelf: true }))
    expect(resolved.id).toBe('/real/uni-h5.es.js')
  })

  it('leaves every other module alone', async () => {
    const instance = plugin()

    expect(await resolveId(instance, {}, '@dcloudio/uni-h5/style.css', '/src/main.ts', {})).toBeUndefined()
    expect(await resolveId(instance, {}, 'vue', '/src/main.ts', {})).toBeUndefined()
  })

  it('generates a wrapper that keeps uni-h5 exports and overrides the desktop APIs', () => {
    const instance = plugin()

    const loaded = load(instance, '\0uni-desktop/uni-h5')

    expect(loaded).toBeTruthy()
    const code = typeof loaded === 'string' ? loaded : loaded.code
    expect(code).toContain(`export * from '${UNI_H5_ID}'`)
    expect(code).toContain('\'@uni-helper/desktop/shim/apis\'')
    expect(code).toContain('createOpenDocument')
    // The desktop implementations replace uni-h5's own exports.
    expect(code).toContain('export const openDocument = createOpenDocument(openDocumentH5)')
    expect(code).toContain('export { getSavedFileInfo, getSavedFileList, removeSavedFile, saveFile }')
  })

  it('does not load other modules', () => {
    const instance = plugin()

    expect(load(instance, '/src/main.ts')).toBeUndefined()
  })
})
