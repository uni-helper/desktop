<a href="https://github.com/uni-helper/desktop"><img src="https://cdn.jsdelivr.net/gh/uni-helper/desktop@main/banner.svg" alt="banner" width="100%"/></a>

# @uni-helper/desktop

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/uni-helper/desktop@main/logo.svg" alt="logo" width="256" height="256"/>
</p>

<p align="center">
  <a href="https://github.com/uni-helper/desktop/blob/main/LICENSE.md"><img src="https://img.shields.io/github/license/uni-helper/desktop?style=for-the-badge&labelColor=005947&color=eee" alt="License"></a>
  <a href="https://github.com/uni-helper/desktop/stargazers"><img src="https://img.shields.io/github/stars/uni-helper/desktop?style=for-the-badge&labelColor=005947&color=eee" alt="Stars"></a>
  <a href="https://www.npmjs.com/package/@uni-helper/desktop"><img src="https://img.shields.io/npm/v/@uni-helper/desktop?style=for-the-badge&labelColor=005947&color=eee" alt="NPM Version"></a>
  <a href="https://www.npmjs.com/package/@uni-helper/desktop"><img src="https://img.shields.io/npm/dm/@uni-helper/desktop?style=for-the-badge&labelColor=005947&color=eee" alt="NPM Downloads"></a>
</p>

<p align="center">
  <a href="https://github.com/FliPPeDround"><img src="https://img.shields.io/badge/Author%20%26%20Maintainer-FliPPeDround-blue?style=for-the-badge" alt="Author & Maintainer"></a>
</p>

让 uni-app（Vue3 + Vite CLI 工程）直接变成桌面应用：`uni dev -p desktop` 打开 Electron 窗口，`uni build -p desktop` 产出 Windows / macOS / Linux 安装包。业务代码保持标准 `uni.xxx` 写法，跨端零改动。

不想看文档？直接问 AI 🤖 <a href="https://deepwiki.com/uni-helper/desktop"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>

## 快速开始

**1. 安装依赖**（peer 要求 Electron ≥ 25、electron-builder ≥ 24、electron-updater ≥ 6，三者都是可选 peer，不装则对应能力不可用）

```sh
pnpm add -D @uni-helper/desktop electron electron-builder electron-updater
```

**2. 在 package.json 声明桌面平台**

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

**3. 在 vite.config.ts 注册插件**

```ts
import uni from '@dcloudio/vite-plugin-uni'
import { uniDesktop } from '@uni-helper/desktop/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [uni(), uniDesktop()],
})
```

**4. 运行**

```sh
pnpm dev:desktop   # 等价于 uni dev -p desktop
```

Electron 窗口自动打开，Vite 热更新正常使用。首次运行会自动补齐其余接线：manifest.json 的 hash 路由、`unh.config.ts`、npm scripts，缺依赖时交互式安装。HBuilderX 用户保存 package.json 后，运行菜单会自动出现「Desktop」。

## 打包

```sh
pnpm build:desktop   # 等价于 uni build -p desktop
```

安装包输出在 `dist/build/desktop/release`：Windows（NSIS）/ macOS（dmg）/ Linux（AppImage）。只想构建不打包，设 `pack.autoPack: false`。

## 配置

在项目根目录创建 `unh.config.ts`（首次运行缺文件时会自动创建）。所有字段可选，未配置的回退到 manifest.json 的对应值：

```ts
import { defineConfig } from '@uni-helper/desktop'

export default defineConfig({
  desktop: {
    app: {
      name: 'my-app', // 默认取 manifest.json 的 name
      icon: 'static/logo.png', // 512x512+ PNG，窗口/托盘/安装包共用，省略时用内置图标
    },
    window: {
      width: 420,
      height: 760,
      closeToTray: false, // 关闭窗口时隐藏到托盘而非退出
    },
    tray: { // 设为 false 关闭托盘
      menu: [{ label: '打开窗口', action: 'show' }, { role: 'quit' }],
    },
    updater: { // 设为 false 关闭自动更新
      provider: 'generic',
      url: 'https://example.com/updates/',
    },
    pack: {
      targets: {
        win: ['nsis'],
        mac: ['dmg'],
        linux: ['AppImage'],
      },
    },
  },
})
```

窗口尺寸、DevTools、appId、copyright、签名与公证（`pack.win` / `pack.mac` 透传 electron-builder）、asar 等更多选项见 `defineConfig` 的类型提示。

## 条件编译

`DESKTOP` 是一个独立的条件编译平台，js / 模板 / css / pages.json / manifest.json 中都可以用：

```vue
<!-- #ifdef DESKTOP -->
<button @click="minimize">
最小化窗口
</button>
<!-- #endif -->
```

`H5` 只代表浏览器构建：桌面构建中 `#ifdef H5` 会被剔除。想让代码在浏览器与桌面都生效，用 `#ifdef H5 || DESKTOP` 或写在条件块外。

## 常用能力

### uni API 垫片

H5 已实现的 API 一律沿用原版；H5 没有实现的由垫片补齐，业务代码零改动：

| API | 桌面端行为 |
| --- | --- |
| `uni.saveFile` | 保存文件到应用管理目录，返回 `savedFilePath` |
| `uni.getSavedFileList` / `getSavedFileInfo` / `removeSavedFile` | 管理目录内文件的增删查 |
| `uni.openDocument` | 保存的文件交给系统默认程序打开 |
| `uni.getUpdateManager` | 桥接 electron-updater |
| `uni.getFileSystemManager` | 管理目录内 `readFile` / `writeFile` |

垫片由 `uniDesktop` 插件自动注入，无需手动导入；纯浏览器打开时整体 no-op。

### 自动更新

```js
const manager = uni.getUpdateManager()

manager.onUpdateReady(() => manager.applyUpdate())
```

### 无边框窗口

`frame: false` 时用窗口控制桥：

```ts
// #ifdef DESKTOP
import { desktopWindow } from '@uni-helper/desktop/shim'

desktopWindow.minimize()
desktopWindow.toggleMaximize()
desktopWindow.close()
// #endif
```

### 自定义主进程

默认主进程模板覆盖标准场景（窗口、托盘、更新、垫片 IPC）。需要自定义时，把 `main.entry` 指向自己的入口，从 `@uni-helper/desktop/main` 导入 `createDesktopApp` 复用内置能力（它不在包根导出）；也可以完全不用它，自己写 Electron 主进程。

## 注意事项

- manifest.json 必须是 hash 路由 + `./` base（首次运行自动设置），否则 file:// 加载白屏
- `uni.saveFile` 的 `tempFilePath` 必须是当前页面仍有效的选择结果，刷新后失效
- 保存文件单文件上限 512 MB，管理目录内最多 2000 个文件
- 垫片在 dev 下改写全局 `window.uni`，编译构建替换 uni-h5 的模块导出；业务代码统一写 `uni.xxx` 即可

## 完整示例

见 [examples/quick-start](./examples/quick-start)。

## 参与贡献

欢迎提交 PR，开发流程与门禁见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](https://github.com/uni-helper/desktop/blob/main/LICENSE.md) License © [uni-helper](https://github.com/uni-helper)

## 赞助

如果你觉得这个项目对你的跨端开发有所帮助，欢迎支持作者持续维护：

<p align="center">
  <a href="https://afdian.com/a/flippedround">
    <img alt="sponsors" src="https://cdn.jsdelivr.net/gh/FliPPeDround/sponsors/sponsorkit/sponsors.svg" />
  </a>
</p>

---
