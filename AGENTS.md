# @uni-helper/desktop

把一个 uni-app（Vue3 + Vite CLI 工程）编译成 Electron 桌面应用：注册一个 vite 插件，
用 `uni -p desktop` 这个自定义平台跑 dev 和 build。业务代码保持标准 `uni.xxx` 写法，
垫片只补 uni-h5 没实现的 API。

## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm knip && pnpm test && pnpm typecheck && pnpm build`.
  Commits follow Conventional Commits.
- 防过度防御：几乎不会发生边界/并发问题，讲清概率并经用户确认后再加，严禁为
"理论上更稳"私自膨胀代码。
- 入口单次校验：外部数据只在边界校验一次，内部靠类型系统流转，禁止层层重复判断。
- 拒绝提前抽象：单次使用逻辑就近内联，不随意提前拆分无意义 helper。
- 控制复杂度：非必要不用try/catch，能单函数清晰搞定的别硬拆。

## Project

- TypeScript `strict`、`noEmit`（类型只由 `pnpm typecheck` 检查），ESM（`"type": "module"`）。
  构建用 tsdown，测试用 vitest + happy-dom。`vite` 只在开发期用到（做类型和驱动插件），
  运行时用的是消费工程自己的 vite。
- 包管理器 pnpm（`packageManager: pnpm@12.8.1`）。workspace 只包含 `examples/*`，
  发布包本身在仓库根，**不在 `packages/` 下**。
- 仓库没有 Node 版本 pin（无 `.node-version`、无 `engines`/`devEngines`）；CI 跑
  node 22 / 24 / 26 / latest。
- 依赖版本全部走 `pnpm-workspace.yaml` 的 `catalog:`：`catalog:build` 是运行时依赖
  （`@clack/prompts`、`@uni-helper/jsonu`、`consola`、`esbuild`、`unconfig`），
  `catalog:cli` / `catalog:desktop` / `catalog:testing` / `catalog:types` 是开发依赖。
  加依赖时同时加 catalog 条目，不要写死版本号。
- peer 依赖 `electron >=25`、`electron-builder >=24`、`electron-updater >=6`，三者都是
  `optional: true`，由用户工程提供，本包不打包它们。`electron` 永远是 esbuild external；
  `electron-updater` 必须打进 main bundle，否则打包后的应用（不带 node_modules）无法更新。
- 产物由 tsdown 三组配置产出：`dist/index.mjs`（`defineConfig`、类型、`DesktopError`，
  无副作用）、`dist/runtime/index.mjs`（主进程运行时）、`dist/shim/*.mjs`（`platform: browser`，
  固定 `.mjs` 后缀）、`dist/vite/index.mjs` + `.cjs`（双格式：旧 vite 用 `require` 加载用户配置），
  另外拷 `dist/templates` 和 `dist/assets/icon.png`。构建里带 publint。
- `tsconfig.json` 的 `paths` 把 `@uni-helper/desktop/*` 映射回 `src/`（示例工程的 tsconfig
  `extends` 了它），所以 `pnpm typecheck` 检查的总是源码；而 vite / uni 运行时按
  `exports` 解析到 `dist/`。改完 `src` 要跑示例或手测时，先 `pnpm build`，否则加载的是旧产物。
- 包**尚未发布**（npm 上 404），API 可随意破坏。

## Commands

```sh
pnpm build              # tsdown 构建 dist/（三组配置 + publint + 模板与图标拷贝）
pnpm dev                # tsdown --watch，边改边重建
pnpm test               # 先 build 再 vitest run（build 是给 api 快照用的，见下）
pnpm exec vitest run test/shim/fs.test.ts   # 跑单个测试文件
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint（antfu config）
pnpm lint:fix           # 同上，加 --fix
pnpm knip               # 找未使用的文件、导出、依赖
pnpm run ci             # lint → typecheck → knip → test（pre-push 与 CI 同一套；
                        # 必须带 `run`，pnpm 自带同名 `pnpm ci` 是清装依赖）
pnpm release            # bumpp：改版本并打 tag，tag 触发 release workflow
pnpm -C examples/quick-start run dev:desktop    # 示例工程：H5 dev server + Electron 窗口
pnpm -C examples/quick-start run build:desktop  # 示例工程：组装 dist/build/desktop
pnpm --filter @uni-helper/desktop-example-quick-start build:desktop  # CI 里的写法
```

测试文件直接 import `src/`，改完源码不用构建就能跑。但 `pnpm test` 会先
`pnpm build`，因为 `test/api-snapshot.test.ts` 用 tsnapi 对着 `dist/` 打公开 API 快照；
只跑 `pnpm exec vitest` 时这个文件会被 `guardStaleBuild` 以源码与 `dist` 不一致拦下，其余文件不受影响。

## Architecture

| 模块 | 职责 |
| --- | --- |
| `src/index.ts` | 包根入口：只导出 `defineConfig`、`DesktopError` 和配置类型，不做任何副作用 |
| `src/types.ts` | `unh.config.ts` 的公开形状：`UnhConfig.desktop` 下的 app / window / dev / tray / updater / main / pack |
| `src/config/resolve.ts` | 读 `unh.config.ts`（unconfig）、`src/manifest.json`（jsonu）、工程 `package.json`，补默认值得到 `ResolvedConfig`；`bakeConfig` 再裁成 JSON 安全的 `BakedDesktopConfig` |
| `src/baked.ts` | 配置进入主进程的唯一通道：经 esbuild define `__DESKTOP_CONFIG__` 注入，只放运行时真正读的字段；资源一律写文件名（electron-builder 会搬目录） |
| `src/vite/index.ts` | 插件本体：h5 构建时用 wrapper 虚拟模块替换 `@dcloudio/uni-h5`，dev 和 build 分别交给 `driver` |
| `src/vite/driver.ts` | dev 起 Electron 壳（组装 → bundle → spawn → 改代码后重启）；build 时 `assembleDesktopApp` 组装 `dist/build/desktop`，再交给 pack |
| `src/vite/setup.ts` | 首次运行的自动接线：`unh.config.ts` 模板、`uni-app.scripts.desktop`、`dev:desktop`/`build:desktop`、manifest 的 hash 路由与 `./` base、缺依赖时交互式安装 |
| `src/orchestrate/bundle.ts` | esbuild 把 main / preload 打成 `.cjs`，externals 只有 `electron` |
| `src/orchestrate/app-bundle.ts` | 仅 macOS dev 需要：改 Electron.app 的 bundle id / 名字 / 图标（含 icns 生成）后 ad-hoc 重签，缓存在 `dist/dev/desktop/electron-cache` |
| `src/orchestrate/pack.ts` | 生成 electron-builder 配置（appId、electronVersion、targets、win/mac/nsis/dmg/linux/publish 透传）并调用 electron-builder |
| `src/orchestrate/pm.ts` | 按 lockfile 向上找包管理器，拼安装命令；Windows 上给参数加引号 |
| `src/orchestrate/electron.ts` | 从用户工程解析 electron 二进制路径、杀进程树 |
| `src/runtime/index.ts` | 主进程运行时 `createDesktopApp`：IPC、`desktop-file://` 协议、窗口硬化、托盘、更新器 |
| `src/shim/channels.ts` | wire 契约的唯一来源：IPC 通道名、`desktop-file` scheme、updater 事件形状 |
| `src/shim/install.ts` + `patch.ts` | 渲染端垫片安装：拦截全局 `window.uni` 的每次赋值并 patch（dev 走这条路径） |
| `src/shim/apis/*` | 逐个 uni API 的桌面实现；`result.ts` 统一 callback / promise 双形态 |
| `src/templates/main.ts`、`preload.ts` | 默认主进程与 preload 源文件，构建时被 esbuild 打包，同时也是 knip 的 entry |
| `src/shared/paths.ts` | 组装目录布局契约 |

### 组装布局是硬契约

`src/shared/paths.ts` 顶部注释定义了 `dist/build/desktop/{package.json,electron/main.cjs,electron/preload.cjs,web,resources}`
这一布局，build 侧（driver、pack、bundle）和运行时侧（`createDesktopApp`）都读它；
`test/driver.test.ts`、`test/bundle.test.ts` 钉住字面量。改目录名要一次改完所有消费者。

### 垫片有两条路径，都得改

dev：uni 运行时把 API 对象写到全局 `window.uni`，`installDesktopShim` 用
getter/setter 拦截每次赋值再 patch（HMR 重新赋值后还要再 patch 一次）。
build：uni 的 vite 流水线把 `uni.xxx()` 改写成 `import { xxx } from '@dcloudio/uni-h5'`，
插件用 wrapper 虚拟模块换掉这个模块并覆写导出。`src/vite/index.ts` 里 wrapper 的导出清单
与 `src/shim/channels.ts` 的通道组是**手工同步**的，加一个 API 两处都要加。

### 主进程安全边界（不要弱化）

- preload 只放行 `allShimChannels` 里的通道，其余 `invoke` 直接 reject。
- 所有带路径的载荷经 `pathFromManagedValue`：realpath 后在允许根目录内校验。
- `hardenNavigation` 用解析后的 URL 比 origin，`http://localhost:5173.evil.com` 不能通过
  `http://localhost:5173` 的判断；非 `http(s)` 的 scheme 不交给 `shell.openExternal`。
- 上限：单文件 512 MB（`MAX_SAVE_BYTES`），管理目录 2000 个文件（`MAX_SAVED_FILES`）。

### 用户文件写入

`package.json`、`manifest.json`、`unh.config.ts` 的改写都是 temp + rename
（`writeFileAtomic`），崩溃时不会留下半个文件。manifest 必须经 `@uni-helper/jsonu`
读写，`JSON.parse` 会丢注释和 `#ifdef`。

## Conventions

- eslint 用 `@antfu/eslint-config`（`type: 'lib'`、antislop、vue 的 `sfcBlocks: false`），
  忽略 `plans/` 与 `index.html`；`src/**` 关掉 `no-console`，但日志走 `src/log.ts` 的
  consola logger（`uni-desktop` tag），不直接 `console.log`。
- 编辑器设置已提交：`.vscode/settings.json` 关掉 prettier、保存时只跑 eslint --fix。
  不要手写格式化，`pnpm lint:fix` 就是格式化。
- 源码 JSDoc 用英文，写"为什么"（例如 `paths.ts`、`channels.ts` 里的不变量原因）；
  README、CONTRIBUTING、`plans/` 用中文。
- 测试放在 `test/`：`test/shim/` 是渲染端垫片，`test/runtime/` 是主进程，其余测配置、
  构建编排与协议。绝大多数测试直接 import `src/`；只有 `test/api-snapshot.test.ts`
  走 `dist/`，用 tsnapi 快照公开导出。改导出后要用
  `TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u` 更新
  `test/__snapshots__/`，并在同一个改动里同步 README。
- `tsdown-stale-guard` 的哈希文件由三个并行配置各自写入，最后完成的那份盖掉全文件，
  所以 `guardStaleBuild` 只覆盖其中一个配置的源码，且不哈希 `dist` 产物
  （`hashOutputs: false`，否则 Windows 上和并行 `copy` 抢文件会 EBUSY）。
- 提交用 Conventional Commits。git hooks 由 `pnpm install` 的 `prepare` 生成到
  `.githooks`（该目录已 gitignore）；pre-commit 只对暂存文件跑 `eslint --fix`，
  pre-push 跑 `pnpm run ci`。临时跳过用 `SKIP_SIMPLE_GIT_HOOKS=1`。
- CI（`.github/workflows/ci.yml`）：`unit-test` 复用 `sxzz/workflows/unit-test.yml`
  （lint + typecheck 在 ubuntu；test 在 ubuntu + windows × node 22/24/26/latest），
  另有 `knip` 和 `example-build`（用示例工程跑真实 uni 打包，并断言产物文件与
  `desktop:uni:saveFile` 通道）。`release.yml` 在推 `v*` tag 时发布。
- 没有版本耦合：peer 只给下限。包未发布，破坏性改动直接改，不留 shim、deprecated 别名
  或迁移路径。

## Project stage

- The package is **unreleased and under active development**: no external users
  depend on the current API surface yet.
- Breaking API changes **MAY** be made freely - renaming or removing exported
  functions, types and options, and changing config file formats. Do not add
  compatibility shims, deprecation aliases or migration paths for unpublished
  APIs.
- A public API change ships together with its updated snapshots and README, per
  the commands in `## Conventions`.
