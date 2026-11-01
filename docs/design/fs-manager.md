# `uni.getFileSystemManager` 桌面垫片设计稿（spike）

状态：设计稿 + 原型（`readFile` / `writeFile` 两个方法已随本稿实现并通过测试）。
规范依据：本仓库 `examples/quick-start` 安装的
`@dcloudio/types/uni-app/uni-patches/wx/index.d.ts` 中的 `FileSystemManager`
接口（第 2702 行起）；该文件未定义 `USER_DATA_PATH` / `TEMP_PATH` 常量（见第
2 节）。`getFileSystemManager` 在 uni-h5 中不存在（0 处实现），属于本仓库
「只补 H5 未实现 API」垫片规则的适用范围。

## 1. v1 方法子集

**纳入 v1（读写核心）：**

| 方法 | 理由 |
| --- | --- |
| `readFile` | 本地文件工作的最小读原语；渲染端按 `encoding` 解码 |
| `writeFile` | 最小写原语；与 `saveFile` 共享上限与落盘策略 |
| `appendFile` | 日志/追加写场景高频，且与 `writeFile` 共享全部基础设施 |
| `unlink` | 删除是配额管理的必要配套（现有 `removeSavedFile` 只认 saved 目录语义） |
| `mkdir` / `readdir` | 目录组织；`readdir` 返回值需换成 `desktop-file://` url 列表 |
| `stat` | 大小/时间，`getSavedFileInfo` 的推广 |
| `access` | 存在性检查，防写前竞态的最小原语 |

**明确推迟（每项一行理由）：**

- `copyFile` / `rename`：跨目录搬移会放大越权面（源/根双重校验），v1 用
  read+write 组合替代。
- `rmdir`：目录树删除不可逆且无回收站语义，等真实需求。
- zip / 压缩系列（`readCompressedFileSync` 等）：纯增益，与安全模型无关。
- watcher（`onChange` 类）：需要 main→renderer 持久推送与去抖，超出 v1。
- `*Sync` 同步变体：渲染进程主线程 IPC 本就是异步等待，同步变体只会造成
  假同步；v1 不提供（决定：不做 trivial wrapper）。
- `open` / `close` / `read`/`write`(fd 系) / `fstat` / `truncate` / `chmod` 等
  fd 句柄族：fd 生命周期跨 IPC 归属主进程，需要句柄表，独立方案再议。

## 2. 根策略（核心设计问题）

**v1 唯一根 = 应用管理目录 `savedRoot()`（`userData/uni-desktop-files`），
`USER_DATA_PATH` 即映射到它。** 所有路径参数一律过
`pathFromManagedValue`（realpath + 根遏制，symlink-aware），与
`saveFile` / `openDocument` 同一语义。

- (a) **v1 里用户文件能否合法离开该根？** 不能。选图/选文档走
  `uni.chooseFile`（H5 返回 `blob:` url）→ `uni.saveFile` 落入管理目录 →
  FS 管理器对 `savedFilePath` 操作。「打开用户任意路径的文件」属于
  file-picker 授权流，超出 v1 威胁模型；若未来放开，必须走「主进程弹原生
  对话框 → 返回一次性授权路径」的模式，不能让渲染端指定任意路径。
- (b) **`uni.env.USER_DATA_PATH` / `TEMP_PATH` 如何暴露？** 已安装的
  `@dcloudio/types` 不含这两个常量（仅微信小程序规范有），uni-h5 也未实现
  `uni.env`。决定：垫片在 `getFileSystemManager()` 返回的管理器对象上附
  `env: { USER_DATA_PATH: <管理目录的 desktop-file:// url> }`；`TEMP_PATH`
  v1 不提供（无独立临时目录，避免第二个根）。
- (c) **`chooseFile` 结果（blob: url）是否需要先桥接？** 需要，且答案已存在：
  复用 `uni.saveFile`（它正是把 blob 字节落到管理目录并返回
  `desktop-file://` url 的桥）。推荐流程：
  `chooseFile → saveFile → fs.readFile(savedFilePath)`。

## 3. 通道形状

**一方法一通道**（`desktop:uni:fs:readFile`、`desktop:uni:fs:writeFile`，见
`src/shim/channels.ts` 的 `fsChannels` 组）。理由：preload 的白名单按通道
枚举，独立通道把「允许读」「允许写」分开审计；与 `shimChannels` 现有模式
一致，`op` 字段复用单通道会失去这层粒度。

载荷（字节统一 `Uint8Array`/`ArrayBuffer` 过 IPC，同 `saveFile`）：

- `readFile` 请求 `{ filePath: string }`；响应 `{ data: ArrayBuffer }`，
  `encoding` 解码在渲染端完成（原型支持 utf-8 与无编码）。
- `writeFile` 请求 `{ filePath: string, data: Uint8Array | ArrayBuffer }`
  （字符串数据渲染端先转 utf-8 字节）；响应 `{}`。

通道组独立于 `shimChannels`（uni API 通道组）；vite wrapper 的导出清单显式
列出 uni API 名，`fsReadFile`/`fsWriteFile` 因此不会作为 uni API 导出，
`getFileSystemManager` 工厂名列于清单（见 `src/vite/index.ts` 的 wrapper
模板）。

## 4. 上限

- 单文件写入继承 `MAX_SAVE_BYTES`（512 MB），`writeFile` 主进程侧强制。
- 文件数量配额与 `saveFile` **共享** `MAX_SAVED_FILES`（2000）：FS 写入与
  saveFile 落盘同在一个目录、同一份配额，分开计数只会造成「两个口子填同一
  个坑」的账目混乱。
- `readFile` 不设上限（读已存在的文件，配额已在写入侧把总量封顶）。

## 5. 错误模型

所有失败经 `invokeUniApi` 以 `errMsg: '<method>:fail <message>'` 抛出
（回调/Promise 双风格同现有垫片）。值得对齐 uni 规范的 errno 风格消息：

- `filePath is required`（缺参）
- `<label> is outside the managed directories`（越界，复用遏制层文案）
- `file exceeds the ${MAX_SAVE_BYTES} byte limit`（超限）
- `the managed file directory is full (max ${MAX_SAVED_FILES} files)`（配额）
- `encoding "..." is not supported by the prototype`（编码，渲染端）
- 读不存在的文件：Node `ENOENT` 消息透传（`realpath`/`readFile` 抛出）

## 6. 安全分析（一页）

- **威胁模型**：渲染进程被视为不可信（与 `hardenNavigation` 注释一致）。
  攻击者持桥后可调用全部白名单通道。
- **遏制**：所有路径参数过 `pathFromManagedValue`（realpath 后必须落在
  realpath 后的 `savedRoot()` 内），symlink 逃逸被现有测试钉住；FS 原型未
  放宽该函数。
- **v1 新增的风险：管理目录内的写原语**。此前渲染端只能「新增」文件
  （saveFile 的 uuid 名），现在可以覆盖目录内任意文件内容。爆炸半径受
  三层约束：目录本身只存应用自管的用户文件；单文件 512 MB 上限；2000 个
  文件配额。覆盖自家管理文件不构成提权路径。
- **明确不授予**：任意绝对路径读写；进程执行；symlink 创建；
  管理目录之外的删除/移动；目录遍历之外的元数据枚举。
- **原型当前的已知限制（有意为之）**：`writeFile` 仅支持覆盖已存在的管理
  目录内文件（realpath 遏制要求目标存在）。**新建文件**需要「realpath 父
  目录 + 校验 basename 无分隔符」的遏制辅助函数，是对
  `pathFromManagedValue` 的第一个真实扩展需求，留给完整实现
  （`mkdir` 同理）。

## 7. 原型（已实现，建议保留）

随本稿落地、全部通过测试的端到端切片：

- 通道：`fsChannels.readFile` / `fsChannels.writeFile`
  （`src/shim/channels.ts`，已并入 preload 白名单 `allShimChannels`）。
- 主进程：`src/runtime/index.ts` 内 `registerIpcHandlers` 的两个 handler
  （遏制 + 上限），测试钉住：根内读写成功、越界/遍历 url/不存在目标拒绝
  （`test/runtime/index.test.ts` 的 `fs manager prototype` 块）。
- 渲染端：`src/shim/apis/fs.ts`（`fsReadFile`/`fsWriteFile`/
  `getFileSystemManager` 工厂，`invokeUniApi` 双风格），`patchUni` 注册
  `uni.getFileSystemManager`，vite wrapper 显式导出工厂（编译产物可用）；
  测试 `test/shim/fs.test.ts`。
- README 垫片表新增一行（标注「初期子集」）。

**结论：原型可保留**。完整实现按本稿第 1 节子集推进时，需先落第 6 节的
「父目录遏制辅助」，再逐方法照第 3/4/5 节复制本切片的形状。
