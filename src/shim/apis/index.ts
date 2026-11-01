export { fsReadFile, fsWriteFile, getFileSystemManager } from './fs'
/**
 * Desktop implementations for the APIs uni-h5 does not implement (saved-file
 * management) and the one deliberate override of an API it does (`openDocument`,
 * whose H5 version cannot hand a file to the OS). Consumed by:
 * - the runtime patch (`patchUni`), which installs them on the `uni` global, and
 * - the build-time module override (`@uni-helper/desktop/vite`), which
 *   re-exports them instead of uni-h5's own `saveFile` / `openDocument` exports.
 */
export { createOpenDocument } from './open-document'
export { getSavedFileInfo, getSavedFileList, removeSavedFile, saveFile } from './saved-file'
export { getUpdateManager } from './update-manager'
export { desktopWindow } from './window-controls'
