# examples/quick-start

仓库里唯一的 workspace 成员，也是唯一端到端跑真实 uni 打包的地方：一个最小
uni-app（Vue3 + Vite CLI）工程，通过 `workspace:*` 依赖本仓库的包。

## 与其他目录的差异

- 这是 private 的示例，不是发布包：`package.json` 的 `name` 是
  `@uni-helper/desktop-example-quick-start`，没有 `exports`/`files`。
- `@dcloudio/*` 全部钉死在 `3.0.0-5030320261023001`（uni-app 的 alpha 版本号），`vite`
  钉在 `5.2.8`，不要改成 `^`：这三者的组合是唯一验证过的。
- `electron` / `electron-builder` / `electron-updater` 来自根目录的 catalog。

## Commands

先在仓库根跑 `pnpm build`：`@uni-helper/desktop` 的 `exports` 指向 `dist/`，
不先构建的话示例解析到的是不存在的产物。

```sh
pnpm -C examples/quick-start run dev:h5        # 纯浏览器：uni（无 Electron）
pnpm -C examples/quick-start run dev:desktop   # H5 dev server + Electron 窗口
pnpm -C examples/quick-start run build:h5      # H5 构建
pnpm -C examples/quick-start run build:desktop # 组装 dist/build/desktop
pnpm --filter @uni-helper/desktop-example-quick-start build:desktop  # CI 里的写法
```

## 约定

- `unh.config.ts` 里写了 `pack.autoPack: false`，所以 `build:desktop` 只组装目录、
  不跑 electron-builder；本地要安装包就删掉这个键或改回 `true`。
- `package.json` 的 `uni-app.scripts.desktop` 必须和 `src/shared/scripts.ts` 的
  `DESKTOP_UNI_SCRIPT` 一致（`UNI_PLATFORM: h5`，`H5`/`WEB` 设成 `false`）；插件启动时会校验，
  `H5`/`WEB` 缺了会警告。留着它们，`#ifdef H5` 才是纯浏览器语义。
- 根 `knip.json` 给这个 workspace 单独写了配置：`vite: false`，`entry` 是
  `src/main.ts` / `src/pages/**/*.vue` / `unh.config.ts`，并忽略 `vite.config.ts` 和几个
  `@dcloudio/*` 依赖。从示例里新引入的 `@dcloudio/*` 包要加进那份 `ignoreDependencies`，
  否则 `pnpm knip` 会报未使用依赖。
- CI（`example-build` job）跑完 `build:desktop` 后断言
  `dist/build/desktop/electron/main.cjs`、`web/index.html`、`resources/icon.png` 存在，
  并 grep `main.cjs` 里的 `desktop:uni:saveFile`。改动组装布局或通道名会直接打红这条 job。
