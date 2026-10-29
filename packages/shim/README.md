# @uni-helper/desktop-shim

Shim uni-app built-in APIs with Electron native capabilities on desktop.

Import it as the first line of your uni-app entry (`src/main.ts`):

```ts
import '@uni-helper/desktop-shim'
```

When running inside an app built with [`@uni-helper/desktop`](../core), the shim bridges H5-missing `uni.*` APIs (`uni.setClipboardData`, `uni.chooseImage`, `uni.saveFile`, `uni.openDocument` and more) to Electron main-process implementations. In plain browsers it is a no-op. All patched APIs support both callback and promise styles.

See the [root README](../../README.md) for the full API table.
