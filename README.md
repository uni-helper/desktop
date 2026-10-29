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
- **uni API 垫片**：只补 H5 端没有实现的内置 API（`uni.saveFile` / `getSavedFileList` / `getSavedFileInfo` / `removeSavedFile`），外加 `openDocument` 对 `desktop-file://` 的桥接；H5 已实现的 API 一律沿用 uni-h5 原版，纯浏览器环境整体 no-op
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

原则：**uni-h5 已经实现的 API 一律沿用原版**，桌面端与 H5 行为完全一致；只有 H5 端没有实现的 API 才由垫片桥接到 Electron 主进程。

| API | H5 端状态 | 桌面端行为 |
| --- | --- | --- |
| `uni.saveFile` | 未实现（直接 fail） | 把临时文件写入应用管理目录，返回 `savedFilePath` |
| `uni.getSavedFileList` | 未实现（直接 fail） | 列出应用管理目录内的文件 |
| `uni.getSavedFileInfo` | 未实现（直接 fail） | 返回文件的 `size` / `createTime` |
| `uni.removeSavedFile` | 未实现（直接 fail） | 删除应用管理目录内的文件 |
| `uni.openDocument` | `window.open(filePath)` | **唯一例外**：`desktop-file://` 路径交给系统默认程序打开，其余路径仍走 H5 原版 |

`uni.setClipboardData`、`uni.getClipboardData`、`uni.chooseImage`、`uni.chooseVideo`、`uni.chooseFile` 等 H5 已实现的 API 不会被改写，行为与 H5 一致。

### 文件路径

`uni.chooseImage` / `chooseVideo` / `chooseFile` 沿用 H5 实现，返回的 `tempFilePath` 是 `blob:` URL。`uni.saveFile` 会在渲染端读取该 URL 的字节并发送给主进程落盘，因此 `tempFilePath` 必须是当前页面仍然有效的选择结果（刷新后失效）。

保存后的 `savedFilePath` 形如 `desktop-file://f/<绝对路径>`，由自定义协议提供给渲染进程加载，并严格限制在应用管理目录内。`uni.getSavedFileList` / `getSavedFileInfo` / `removeSavedFile` / `openDocument` 只接受该目录内的路径。

所有垫片 API 同时支持回调风格与 Promise 风格，错误遵循 `errMsg: 'xxx:fail ...'` 约定。在纯浏览器环境打开时垫片整体 no-op。

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
