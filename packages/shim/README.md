# @uni-helper/desktop-shim

Shim the uni-app built-in APIs that uni-h5 does not implement, backed by Electron native capabilities.

Import it as the first line of your uni-app entry (`src/main.ts`):

```ts
import '@uni-helper/desktop-shim'
```

The shim only patches APIs that uni-h5 leaves unimplemented: `uni.saveFile`, `uni.getSavedFileList`, `uni.getSavedFileInfo` and `uni.removeSavedFile`, plus `uni.openDocument` for `desktop-file://` paths. Everything uni-h5 already ships (clipboard, `chooseImage` / `chooseVideo` / `chooseFile`, ...) is left untouched so desktop behaviour stays identical to H5. In plain browsers the whole shim is a no-op. All patched APIs support both callback and promise styles. `saveFile` sends the picked bytes over IPC as a `Uint8Array`, so large files never get expanded into a base64 string. The IPC channel names are also exported from `@uni-helper/desktop-shim/channels`, which lets a main process reuse the contract without importing the renderer-side installer.

See the [root README](../../README.md#垫片支持的-api) for the full API table.
