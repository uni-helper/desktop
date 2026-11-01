# @uni-helper/desktop

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

让 uni-app（Vue3 + Vite CLI 工程）获得打包成 Electron 桌面应用的能力：桌面端是 uni 的一个自定义平台，`uni dev -p desktop` 直接打开 Electron 窗口、`uni build -p desktop` 直接产出安装包；外加一层 uni API 桌面垫片，用户代码保持标准 `uni.xxx` 写法、跨端零改动。

## 特性

- **真平台体验**：`uni dev -p desktop` 在 dev server 就绪后自动打开 Electron 窗口（Vite 热更新、主进程改动自动重启）；`uni build -p desktop` 组装 `dist/build/desktop` 并用 electron-builder 生成 Windows（NSIS）/ macOS（dmg）/ Linux（AppImage）安装包
- **自定义条件编译平台**：`#ifdef DESKTOP` 覆盖 js/模板/css/pages.json/manifest.json，`#ifdef H5` 只代表浏览器构建
- **启动自检**：首次运行自动补齐 manifest.json 路由规范、垫片导入、`unh.config.ts`、npm scripts，缺依赖时交互式安装（TTY 下逐项确认，CI 自动应用安全项）
- **uni API 垫片**：只补 H5 端没有实现的内置 API（`uni.saveFile` / `getSavedFileList` / `getSavedFileInfo` / `removeSavedFile`），外加 `openDocument` 对 `desktop-file://` 的桥接；H5 已实现的 API 一律沿用 uni-h5 原版，纯浏览器环境整体 no-op
- **SDK 配置**：所有窗口、托盘、更新、打包选项集中在 `unh.config.ts` 的 `desktop` 键下，未覆盖的值回退到 `manifest.json`
- **零 CLI**：没有 `uni-desktop` 命令，唯一接线是一个 vite 插件，其余全部通过 uni 自己的平台机制驱动

## 使用

### 已有 uni-app 项目

安装依赖：

```sh
pnpm add -D @uni-helper/desktop electron electron-builder electron-updater
```

要求 Electron ≥ 25（运行时用到 `protocol.handle` 与内置 Node 18 的全局 `Request`/`Response`）。

做两处接线。其一，在 package.json 声明桌面平台（uni 官方的自定义条件编译平台，缺少它时运行会得到明确报错与可粘贴片段，见[条件编译](#条件编译)）：

```json
{
  "uni-app": {
    "scripts": {
      "desktop": {
        "title": "Desktop",
        "env": { "UNI_PLATFORM": "h5" },
        "define": { "DESKTOP": true, "H5": false, "WEB": false }
      }
    }
  }
}
```

其二，`vite.config.ts` 注册 `uniDesktop` 插件（编译产物里 uni 会把所有 `uni.xxx` 调用重写为对 `@dcloudio/uni-h5` 的具名导入，必须靠它在模块层拦截替换；dev 下它还负责驱动 Electron）：

```ts
import uni from '@dcloudio/vite-plugin-uni'
import { uniDesktop } from '@uni-helper/desktop/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [uni(), uniDesktop()],
})
```

其余的交给启动自检：把 manifest.json 的 `h5.router` 规范为 hash 路由 + `./` base（file:// 加载要求）、创建 `unh.config.ts`、追加 `dev:desktop` / `build:desktop` npm scripts；缺依赖时交互式询问安装。TTY 中逐项确认，CI（非 TTY）自动应用安全项并打印提示。垫片由 `uniDesktop` 插件直接注入页面，业务代码零改动。

### 开发

```sh
uni dev -p desktop          # 等价于 pnpm dev:desktop
pnpm dev:desktop
```

dev server 就绪后 Electron 窗口自动打开，正常使用 Vite 热更新；主进程改动自动重启窗口，渲染进程改动走 uni dev server 的 HMR。dev 的桌面壳运行时与其他平台一样写在 `dist/dev/desktop`（`electron/` 主进程与 preload、`resources/` 图标；macOS 的改名壳缓存在 `electron-cache/`，按 electron 版本 / 应用名 / 图标复用）。

### 构建与打包

```sh
uni build -p desktop        # 等价于 pnpm build:desktop
pnpm build:desktop          # H5 构建 + 组装 dist/build/desktop + electron-builder 打包
```

组装产物在 `dist/build/desktop`（uni 的 web 构建产物由 `dist/build/h5` 整体移入其中的 `web/`，成功后不残留 `h5` 目录），安装包输出到其中的 `dist/build/desktop/release`（可通过 `pack.output` 修改）。`pack.autoPack: false` 时只组装不出安装包。

`electron` 的版本会从项目自身的依赖中读取并写入 electron-builder 配置（`electronVersion`），因此不必在 `package.json` 里把版本写死。Linux 的 `deb` 目标额外要求 `app.author` 与 `app.homepage`，两者默认从项目 `package.json` 的 `author` / `homepage` 读取。

图标通过 `app.icon` 指定，建议提供一张 512x512 以上的 PNG；不配置时使用内置的 uni-helper 图标，因此窗口、Dock/任务栏、托盘和安装包都不会退回 Electron 的默认图标。macOS 上 dev 模式会把 Electron 的 app bundle 克隆到 `dist/dev/desktop/electron-cache` 并改写其中的应用名与图标（adhoc 重签后启动，按 electron 版本 / 应用名 / 图标缓存），Dock 从启动那一刻起就显示配置的应用名和图标而不是 "Electron"；克隆失败时回退为直接启动 Electron，由运行时的 `app.dock.setIcon` 兜底设置图标。

dev 模式下桌面壳由 uni 进程通过 IPC 启动，uni 进程退出时壳自动关闭，不会残留孤儿窗口。

命令行进度输出由 [consola](https://github.com/unjs/consola) 渲染：终端里按级别着色（`start` / `info` / `success` / `warn` / `error`），每行带 `[uni-desktop]` 标签，方便和 dev server、Electron 自身的输出区分；输出被重定向或运行在 CI 时自动退化为不带颜色的纯文本。

### 完整示例

见 [examples/quick-start](./examples/quick-start)。

## 配置

在项目根目录创建 `unh.config.ts`（`defineConfig` 提供类型提示；首次运行缺文件时会自动创建）。所有桌面端配置都放在 `desktop` 键下，这样同一个文件还能承载其他 uni-helper 工具的顶层配置：

```ts
import { defineConfig } from '@uni-helper/desktop'

export default defineConfig({
  desktop: {
    app: {
      name: 'my-app', // 默认取 manifest.json 的 name
      appId: 'com.example.my-app', // 默认派生自 name
      version: '1.0.0', // 默认取 manifest.json 的 versionName
      icon: 'static/logo.png', // 512x512+ PNG，窗口/Dock/托盘/安装包共用；省略时用内置 uni-helper 图标
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
      // 缺省时加载 uni dev server 实际监听的地址；仅在壳需要加载别的地址时设置
      url: 'http://localhost:5173',
      openDevtools: true, // 自动打开 DevTools
    },
    tray: { // 设为 false 关闭托盘
      icon: 'static/tray.png', // 省略时回退到 app.icon
      tooltip: 'My App',
      menu: [{ role: 'quit' }],
    },
    updater: { // 设为 false 关闭自动更新
      provider: 'generic',
      url: 'https://example.com/updates/',
      autoDownload: true,
      autoInstallOnAppQuit: true,
    },
    main: {
      entry: 'desktop/main.ts', // 自定义主进程入口（可选）
    },
    pack: {
      autoPack: true, // `uni build -p desktop` 后自动运行 electron-builder
      output: 'dist/build/desktop/release',
      asar: true,
      targets: {
        win: ['nsis'],
        mac: ['dmg'],
        linux: ['AppImage'], // deb 需要 app.author / app.homepage，默认不开启
      },
      nsis: { oneClick: false },
      publish: { provider: 'generic', url: 'https://example.com/updates/' },
    },
  },
})
```

`unh.config.ts` 由 [unconfig](https://github.com/unocss/unocss/tree/main/packages/unconfig) 加载，因此 `unh.config.{ts,mts,js,mjs,cjs,json}` 都可以使用。`desktop` 之外的顶层键会被忽略，留给其他工具消费。

`manifest.json` 由 [@uni-helper/jsonu](https://github.com/uni-helper/jsonu) 解析，支持 uni-app 的 `#ifdef` 条件编译注释，按 DESKTOP 平台求值（与编译期视图一致，见[条件编译](#条件编译)）。启动自检补全 `h5.router` 时会保留条件编译块（重写文件时普通注释会被移除，仅条件编译注释往返保留）。

所有字段都是可选的，未配置的值按 `defaults < manifest.json < unh.config.ts 的 desktop` 合并。

> 要求：manifest.json 的 `h5.router.mode` 必须是 `hash`、`h5.router.base` 必须是 `./`，否则 file:// 加载会白屏。启动自检会自动设置并校验告警。

## 条件编译

桌面端是 uni 官方的自定义条件编译平台，在 package.json 中声明（使用章节的接线步骤之一）：

```json
{
  "uni-app": {
    "scripts": {
      "desktop": {
        "title": "Desktop",
        "env": { "UNI_PLATFORM": "h5" },
        "define": { "DESKTOP": true, "H5": false, "WEB": false }
      }
    }
  }
}
```

`DESKTOP` 是一个独立平台：uni 编译器在所有支持条件编译的文件中保留 `#ifdef DESKTOP` 块；`H5` / `WEB` 被置为 false，桌面构建中 `#ifdef H5` 与其他平台一样被剔除（`H5` 只代表浏览器构建）。想让同一段代码在浏览器与桌面都生效，用 `#ifdef H5 || DESKTOP` 或写在条件块外：

```js
// #ifdef DESKTOP
console.log('只在桌面端执行')
// #endif

// #ifndef DESKTOP
console.log('非桌面端执行（纯浏览器打开时）')
// #endif
```

```vue
<!-- #ifdef DESKTOP -->
<button @click="minimize">
  最小化窗口
</button>
<!-- #endif -->

<style>
/* css 中必须用块注释 */
/* #ifdef DESKTOP */
.titlebar { display: block; }
/* #endif */
</style>
```

pages.json / manifest.json 中同样支持（`// #ifdef DESKTOP` 包裹节点，条件成员后写的覆盖先写的）。

语义边界：

- `uni dev -p desktop` / `uni build -p desktop` 即桌面构建；`dev:desktop` / `build:desktop` npm scripts 是它们的便捷封装（启动自检自动追加）。
- 直接运行 `dev:h5` / `build:h5`（普通 `uni` 命令）是真正的浏览器构建：`DESKTOP` 未定义、`H5` 正常生效，插件不驱动任何桌面行为。
- HBuilderX 用户：package.json 保存后，运行/发行菜单会自动出现「Desktop」。
- manifest.json 视图一致：本项目提取应用名、窗口标题等配置时同样按 DESKTOP 平台求值（`@uni-helper/jsonu`），与编译期看到的内容一致：manifest 里的 `#ifdef DESKTOP` 值会被采用，`#ifdef H5` 值被剔除。
- 运行时区分桌面壳与纯浏览器：检测 preload 注入的桥 `!!window.__UNI_DESKTOP_BRIDGE__`。

## 垫片支持的 API

原则：**uni-h5 已经实现的 API 一律沿用原版**，桌面端与 H5 行为完全一致；只有 H5 端没有实现的 API 才由垫片桥接到 Electron 主进程。

垫片在两条路径上生效，共用同一份实现，全部由 `uniDesktop` 插件注入，无需在业务代码里导入：编译产物里 `uni.xxx` 调用被 uni 重写为 `@dcloudio/uni-h5` 的具名导入，由插件生成的 uni-h5 wrapper 模块替换导出；dev server 下 uni 运行时把 API 对象填进全局 `uni`（build 摇树时 uni 会把它替换成空对象），wrapper 求值时会装好 `window.uni` 赋值拦截器，任何后续赋值都会被就地打补丁。两条路径缺一不可。

注意：dev 下 `window.wx` 与 `window.uni` 是同一个对象，会一并获得桌面实现；build 摇树后 uni 将 `window.wx` 置为空对象且垫片不做补丁，桌面构建请使用 `uni.*`。

| API | H5 端状态 | 桌面端行为 |
| --- | --- | --- |
| `uni.saveFile` | 未实现（直接 fail） | 把临时文件写入应用管理目录，保留扩展名（未知类型可传 `fileName` 指定），返回 `savedFilePath` |
| `uni.getSavedFileList` | 未实现（直接 fail） | 列出应用管理目录内的文件 |
| `uni.getSavedFileInfo` | 未实现（直接 fail） | 返回文件的 `size` / `createTime` |
| `uni.removeSavedFile` | 未实现（直接 fail） | 删除应用管理目录内的文件 |
| `uni.openDocument` | `window.open(filePath)` | **唯一例外**：`desktop-file://` 路径交给系统默认程序打开，其余路径仍走 H5 原版 |

`uni.setClipboardData`、`uni.getClipboardData`、`uni.chooseImage`、`uni.chooseVideo`、`uni.chooseFile` 等 H5 已实现的 API 不会被改写，行为与 H5 一致。

### 文件路径

`uni.chooseImage` / `chooseVideo` / `chooseFile` 沿用 H5 实现，返回的 `tempFilePath` 是 `blob:` URL。`uni.saveFile` 会在渲染端读取该 URL 的字节并发送给主进程落盘，因此 `tempFilePath` 必须是当前页面仍然有效的选择结果（刷新后失效）。

保存后的 `savedFilePath` 形如 `desktop-file://f/<绝对路径>`，由自定义协议提供给渲染进程加载，并严格限制在应用管理目录内。文件字节以 `Uint8Array` 形式通过 IPC 传输（不再转 base64），大文件不会额外占用数倍内存。`uni.getSavedFileList` / `getSavedFileInfo` / `removeSavedFile` / `openDocument` 只接受该目录内的路径。

所有垫片 API 同时支持回调风格与 Promise 风格，错误遵循 `errMsg: 'xxx:fail ...'` 约定。在纯浏览器环境打开时垫片整体 no-op。

保存文件保留原始扩展名：优先取调用方传入的 `fileName`，否则按浏览器上报的 MIME 类型推导；都不已知时保存为无扩展名文件。

## 自动更新

`updater` 配置会启用基于 electron-updater 的自动更新。若未显式配置 `pack.publish`，`updater.provider` 与 `updater.url` 会自动用作 electron-builder 的 publish 配置（生成 app-update.yml）。发布流程本身（签名、渠道、CI 上传）沿用 electron-builder 的标准做法。electron-updater 会随主进程一起打包进应用，打包产物不需要携带 node_modules。

## 自定义主进程

默认主进程模板覆盖标准场景。需要自定义时，把 `main.entry` 指向自己的入口，并通过 `@uni-helper/desktop/main` 复用内置能力：

```ts
// desktop/main.ts
import type { BakedDesktopConfig } from '@uni-helper/desktop/main'
import { createDesktopApp } from '@uni-helper/desktop/main'

declare const __DESKTOP_CONFIG__: BakedDesktopConfig

createDesktopApp(__DESKTOP_CONFIG__)
```

`createDesktopApp` 内部处理：窗口创建与加载（dev URL 或打包后的 web/index.html）、全部垫片 IPC handler、`desktop-file://` 协议、托盘与自动更新，另外还有：

- 单实例锁：重复启动会聚焦已有窗口，而不是再开一个进程
- 导航加固：外部链接交给系统浏览器，窗口不会被渲染进程导航到任意站点（否则 preload 桥会被带到远程页面）
- dev 断连自护：uni dev 进程退出时自动关闭窗口，不会残留孤儿进程（自定义主进程同样生效）
- 图标路径按组装后的目录解析，安装到用户机器后依然有效

也可以完全不使用它，自己写 Electron 主进程。

## 包结构

单包发布，所有能力通过子路径导出提供：

| 导入 | 说明 |
| --- | --- |
| `@uni-helper/desktop` | `defineConfig` 与类型 |
| `@uni-helper/desktop/shim` | 渲染端 uni API 垫片（由 `uniDesktop` 插件注入页面，无需手动导入） |
| `@uni-helper/desktop/shim/channels` | 垫片 IPC 通道契约，自定义主进程可复用 |
| `@uni-helper/desktop/shim/apis` | 垫片 API 实现（`uniDesktop` 插件的模块替换层引用） |
| `@uni-helper/desktop/vite` | `uniDesktop` vite 插件，在 `vite.config.ts` 中注册，驱动整个桌面平台 |
| `@uni-helper/desktop/main` | 自定义主进程入口复用的 `createDesktopApp` |

## License

[MIT](./LICENSE.md) License © [FliPPeDround](https://github.com/flippedround)

[npm-version-src]: https://img.shields.io/npm/v/@uni-helper/desktop?style=flat-square
[npm-version-href]: https://npmjs.com/package/@uni-helper/desktop
[npm-downloads-src]: https://img.shields.io/npm/dm/@uni-helper/desktop?style=flat-square
[npm-downloads-href]: https://npmjs.com/package/@uni-helper/desktop
[license-src]: https://img.shields.io/github/license/uni-helper/desktop.svg?style=flat-square
[license-href]: https://github.com/uni-helper/desktop/blob/main/LICENSE.md
