# @uni-helper/desktop

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

让 uni-app（Vue3 + Vite CLI 工程）获得打包成 Electron 桌面应用的能力：SDK 配置驱动的 dev/build/pack 编排，外加一层 uni API 桌面垫片，用户代码保持标准 `uni.xxx` 写法、跨端零改动。

## 特性

- **`uni-desktop dev`**：启动 H5 dev server，就绪后自动打开 Electron 窗口加载它，渲染进程走 Vite 热更新，主进程改动自动重启窗口
- **`uni-desktop build`**：构建 H5 产物，组装成 Electron 应用目录（`dist/desktop`），再用 electron-builder 生成 Windows（NSIS）/ macOS（dmg）/ Linux（AppImage、deb）安装包
- **`uni-desktop pack`**：对已组装的 `dist/desktop` 单独打包
- **`uni-desktop init`**：脚手架 `unh.config.ts`、规范化 manifest.json（hash 路由 + 相对 base）、安装依赖
- **uni API 垫片**：`uni.setClipboardData`、`uni.chooseImage`、`uni.saveFile`、`uni.openDocument` 等 H5 端缺失或不完整的内置 API，在桌面端桥接到 Electron 原生能力；纯浏览器环境自动 no-op
- **SDK 配置**：所有窗口、托盘、更新、打包选项集中在 `unh.config.ts` 的 `desktop` 键下，未覆盖的值回退到 `manifest.json`

## 使用

### 已有 uni-app 项目

在项目根目录执行：

```sh
pnpm dlx @uni-helper/desktop-cli init
```

`init` 会完成：写入 `unh.config.ts`、追加 `desktop:*` 脚本、把 manifest.json 的 `h5.router` 规范为 hash 路由 + `./` base、在 `src/main.ts` 首行注入垫片导入、安装依赖。

也可以手动安装：

```sh
pnpm add @uni-helper/desktop-shim
pnpm add -D @uni-helper/desktop @uni-helper/desktop-cli electron electron-builder electron-updater
```

然后确保 `src/main.ts` 首行引入垫片：

```ts
import '@uni-helper/desktop-shim'
```

### 开发

```sh
pnpm desktop:dev            # 等价于 uni-desktop dev
pnpm desktop:dev -- --url http://localhost:3000   # 覆盖 dev.url
```

dev server 就绪后 Electron 窗口自动打开，正常使用 Vite 热更新。

### 构建与打包

```sh
pnpm desktop:build          # H5 构建 + 组装 dist/desktop + electron-builder 打包
pnpm desktop:build -- --no-pack   # 只组装，不出安装包
pnpm desktop:pack           # 对已有 dist/desktop 单独打包
```

安装包输出到 `dist/release`（可通过 `pack.output` 修改）。窗口/安装包图标通过 `app.icon` 指定，建议提供一张 512x512 以上的 PNG。

### 完整示例

见 [examples/quick-start](./examples/quick-start)。

## 配置

在项目根目录创建 `unh.config.ts`（`defineConfig` 提供类型提示）。所有桌面端配置都放在 `desktop` 键下，这样同一个文件还能承载其他 uni-helper 工具的顶层配置：

```ts
import { defineConfig } from '@uni-helper/desktop'

export default defineConfig({
  desktop: {
    app: {
      name: 'my-app',              // 默认取 manifest.json 的 name
      appId: 'com.example.my-app', // 默认派生自 name
      version: '1.0.0',            // 默认取 manifest.json 的 versionName
      icon: 'static/logo.png',     // 512x512+ PNG
      copyright: '© 2026 Example',
    },
    window: {
      title: 'My App',
      width: 420,
      height: 760,
      minWidth: 320,
      minHeight: 500,
      center: true,
      resizable: true,
      frame: true,
      titleBarStyle: 'default',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
    },
    dev: {
      url: 'http://localhost:5173', // Electron 在 dev 模式加载的地址
      command: 'dev:h5',            // 启动 H5 dev server 的 npm script
      waitTimeout: 60000,           // 等待 URL 可访问的超时
      interval: 500,                // 探测间隔
      openDevtools: true,           // 自动打开 DevTools
    },
    build: {
      command: 'build:h5',          // 构建 H5 的 npm script
    },
    tray: {                         // 设为 false 关闭托盘
      icon: 'static/tray.png',
      tooltip: 'My App',
      menu: [{ role: 'quit' }],
    },
    updater: {                      // 设为 false 关闭自动更新
      provider: 'generic',
      url: 'https://example.com/updates/',
      autoDownload: true,
      autoInstallOnAppQuit: true,
    },
    main: {
      entry: 'desktop/main.ts',     // 自定义主进程入口（可选）
    },
    pack: {
      autoPack: true,               // build 后自动运行 electron-builder
      output: 'dist/release',
      asar: true,
      targets: {
        win: ['nsis'],
        mac: ['dmg'],
        linux: ['AppImage', 'deb'],
      },
      nsis: { oneClick: false },
      publish: { provider: 'generic', url: 'https://example.com/updates/' },
    },
  },
})
```

`unh.config.ts` 由 [unconfig](https://github.com/unocss/unocss/tree/main/packages/unconfig) 加载，因此 `unh.config.{ts,mts,js,mjs,cjs,json}` 都可以使用。`desktop` 之外的顶层键会被忽略，留给其他工具消费。

所有字段都是可选的，未配置的值按 `defaults < manifest.json < unh.config.ts 的 desktop` 合并。

> 要求：manifest.json 的 `h5.router.mode` 必须是 `hash`、`h5.router.base` 必须是 `./`，否则 file:// 加载会白屏。`init` 会自动设置，构建时也会校验并告警。

## 垫片支持的 API

在 Electron 环境中，以下 `uni.*` API 由垫片桥接到主进程原生实现：

| API | 行为 |
| --- | --- |
| `uni.setClipboardData` | Electron clipboard 写入 |
| `uni.getClipboardData` | Electron clipboard 读取 |
| `uni.chooseImage` | 原生文件对话框，多选，返回 `tempFilePaths` / `tempFiles` |
| `uni.chooseVideo` | 原生文件对话框，单选，返回 `tempFilePath` |
| `uni.chooseFile` | 原生文件对话框，支持 `count` / `extension` |
| `uni.saveFile` | 把临时文件持久化到应用管理目录，返回 `savedFilePath` |
| `uni.getSavedFileList` | 列出持久化文件 |
| `uni.removeSavedFile` | 删除持久化文件 |
| `uni.openDocument` | 调用系统默认程序打开文件 |

选中的文件会复制到应用管理的临时目录，并通过自定义的 `desktop-file://` 协议提供给渲染进程加载（严格限制在应用管理的目录内）。所有 API 同时支持回调风格与 Promise 风格，错误遵循 `errMsg: 'xxx:fail ...'` 约定，用户取消时返回 `fail cancel`。

未列出的 API 保持 uni-h5 原生行为；在纯浏览器环境打开时垫片整体 no-op。

## 自动更新

`updater` 配置会启用基于 electron-updater 的自动更新。若未显式配置 `pack.publish`，`updater.provider` 与 `updater.url` 会自动用作 electron-builder 的 publish 配置（生成 app-update.yml）。发布流程本身（签名、渠道、CI 上传）沿用 electron-builder 的标准做法。

## 自定义主进程

默认主进程模板覆盖标准场景。需要自定义时，把 `main.entry` 指向自己的入口，并通过 `@uni-helper/desktop/main` 复用内置能力：

```ts
// desktop/main.ts
import type { BakedDesktopConfig } from '@uni-helper/desktop/main'
import { createDesktopApp } from '@uni-helper/desktop/main'

declare const __DESKTOP_CONFIG__: BakedDesktopConfig

createDesktopApp(__DESKTOP_CONFIG__)
```

`createDesktopApp` 内部处理：窗口创建与加载（dev URL 或打包后的 web/index.html）、全部垫片 IPC handler、`desktop-file://` 协议、托盘与自动更新。也可以完全不使用它，自己写 Electron 主进程。

## 包结构

| 包 | 说明 |
| --- | --- |
| [`@uni-helper/desktop`](./packages/core) | 核心：配置解析、dev/build/pack 编排、主进程模板与运行时 |
| [`@uni-helper/desktop-shim`](./packages/shim) | 渲染端 uni API 垫片与 IPC 契约 |
| [`@uni-helper/desktop-cli`](./packages/cli) | `uni-desktop` 命令行工具 |

## License

[MIT](./LICENSE) License © [FliPPeDround](https://github.com/flippedround)

[npm-version-src]: https://img.shields.io/npm/v/@uni-helper/desktop?style=flat-square
[npm-version-href]: https://npmjs.com/package/@uni-helper/desktop
[npm-downloads-src]: https://img.shields.io/npm/dm/@uni-helper/desktop?style=flat-square
[npm-downloads-href]: https://npmjs.com/package/@uni-helper/desktop
[license-src]: https://img.shields.io/github/license/uni-helper/desktop.svg?style=flat-square
[license-href]: https://github.com/uni-helper/desktop/blob/main/LICENSE
