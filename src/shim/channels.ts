/**
 * The wire contract shared by the main process, the preload allowlist and the
 * renderer shim: IPC channels for APIs that uni-h5 does not implement, the
 * `desktop-file://` scheme and the updater event shape. Channels for APIs
 * uni-h5 already ships (clipboard, chooseImage/Video/File, ...) are
 * deliberately absent: the shim leaves them untouched so desktop behaviour
 * stays identical to H5.
 */

/**
 * URL scheme of the shim's saved-file paths (`desktop-file://f/<path>`),
 * shared by the main process (protocol handler) and the renderer shim
 * (`openDocument` routing) so the wire string has a single home.
 */
export const DESKTOP_FILE_SCHEME = 'desktop-file'

export const shimChannels = {
  saveFile: 'desktop:uni:saveFile',
  getSavedFileList: 'desktop:uni:getSavedFileList',
  getSavedFileInfo: 'desktop:uni:getSavedFileInfo',
  removeSavedFile: 'desktop:uni:removeSavedFile',
  openDocument: 'desktop:uni:openDocument',
  getUpdateManager: 'desktop:uni:getUpdateManager',
} as const

export type ShimChannel = (typeof shimChannels)[keyof typeof shimChannels]

/**
 * Window-control channels for frameless / custom-titlebar windows. Deliberately
 * separate from `shimChannels`: the vite plugin derives the uni-h5 wrapper
 * exports from those keys, and window controls are not uni APIs.
 */
export const windowChannels = {
  minimize: 'desktop:window:minimize',
  toggleMaximize: 'desktop:window:toggleMaximize',
  close: 'desktop:window:close',
} as const

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels]

/**
 * The renderer-triggered updater invoke. `getUpdateManager` (the state fetch)
 * lives in `shimChannels` because it maps one-to-one onto a uni API;
 * `applyUpdate` is the uni-named action channel beside it.
 */
export const updaterChannels = {
  applyUpdate: 'desktop:uni:applyUpdate',
} as const

export type UpdaterChannel = (typeof updaterChannels)[keyof typeof updaterChannels]

/** Main→renderer updater events; main pushes, the preload hook delivers. */
export const updaterEventChannel = 'desktop:updater:event'

/**
 * State pushed to the renderer while the updater runs; uni-shaped by contract.
 * The main process (emitter) and the renderer shim (consumer) both import it
 * from here, so the payload shape cannot drift between the two bundles.
 */
export type UpdaterEvent
  = | { type: 'checkForUpdate' }
    | { type: 'updateAvailable' }
    | { type: 'updateNotAvailable' }
    | { type: 'updateReady', version?: string }
    | { type: 'updateFailed', message: string }

/**
 * File-system channels (prototype subset, see docs/design/fs-manager.md). One
 * channel per method for allowlist granularity, matching `shimChannels`.
 */
export const fsChannels = {
  readFile: 'desktop:uni:fs:readFile',
  writeFile: 'desktop:uni:fs:writeFile',
} as const

export type FsChannel = (typeof fsChannels)[keyof typeof fsChannels]

/** The preload's deny-by-default invoke allowlist: every channel the shim may call. */
export const allShimChannels: (ShimChannel | WindowChannel | UpdaterChannel | FsChannel)[] = [
  ...Object.values(shimChannels),
  ...Object.values(windowChannels),
  ...Object.values(updaterChannels),
  ...Object.values(fsChannels),
]
