# Plan 002: Add execution tests for the main-process runtime

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/runtime/index.ts src/shim/channels.ts src/shared/protocol.ts`
> If any of those files changed since the plan was written, compare the "Current
> state" excerpts against the live code; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (plans 003/004/005/010/015 build on this test file)
- **Category**: tests
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`src/runtime/index.ts` is the security boundary between the renderer (which the
project explicitly treats as hostile — see the `hardenNavigation` comment) and
Node fs/shell: path containment (`pathFromManagedValue`), the `desktop-file://`
protocol handler, per-handler IPC argument validation, and navigation hardening.
It currently has **zero execution tests** — only a tsnapi export-surface snapshot
references it. A refactor that silently drops `realpath` or the root check would
pass every existing test. This plan adds a characterization suite pinning current
behavior; later plans (003 navigation hardening, 004 disconnect guard, 005
extension, 015 payload limits) consciously update specific pins.

## Current state

`src/runtime/index.ts` (334 lines), the relevant seams:

- `createDesktopApp(baked)` (line 292): registers the protocol (before ready),
  IPC handlers, `app.setName`, single-instance lock, then `app.whenReady().then(...)`
  → `applyDockIcon`, `protocol.handle(DESKTOP_FILE_SCHEME, serveDesktopFileRequest)`,
  `createMainWindow(baked)`, `setupTray`, `setupUpdater`.
- `pathFromManagedValue(value, roots, label)` (line 80): renderer-supplied path →
  optional `desktop-file://` parse → `realpath` → must be inside one of the
  realpath-ed roots, else throws `` `${label} is outside the managed directories` ``.
- `serveDesktopFileRequest(request)` (line 108): `realpath(parseDesktopFileUrl(request.url))`
  → 403 when outside `savedRoot()`, 404 on any error, 200 with `content-type`
  from `mimeFromExtension` otherwise.
- IPC handlers (lines 122–172) on channels from `src/shim/channels.ts`:
  `desktop:uni:saveFile` (validates `payload.bytes` is `Uint8Array|ArrayBuffer`,
  extension from `EXTENSION_BY_MIME[mime] ?? ''`, writes UUID file into
  `savedRoot()` = `join(app.getPath('userData'), 'uni-desktop-files')`, returns
  `{ savedFilePath: toDesktopFileUrl(target) }`), `desktop:uni:getSavedFileList`,
  `desktop:uni:getSavedFileInfo`, `desktop:uni:removeSavedFile`,
  `desktop:uni:openDocument` (`shell.openPath`, throws when it returns an error
  string).
- `hardenNavigation(window, devUrl)` (line 180): `setWindowOpenHandler` → allow
  only `url.startsWith(devUrl)`, else deny + `void shell.openExternal(url)`;
  `will-navigate` → allow when startsWith(devUrl), allow any `file://` when no
  devUrl, else preventDefault + `void shell.openExternal(url)`.
- Window creation (line 198): `preload: join(__dirname, 'preload.cjs')`, loads
  `DESKTOP_DEV_URL` env when set, else `loadFile(join(__dirname, '../web/index.html'))`.
- Single instance (line 303): `if (!app.requestSingleInstanceLock()) { app.quit(); return }`.
- Module-level `let mainWindow` persists between `createDesktopApp` calls (line 26).

Known test-environment traps (already discovered; do not rediscover):

1. vitest runs source as ESM, so `__dirname` is undefined inside
   `src/runtime/index.ts` — stub it with `vi.stubGlobal('__dirname', ...)` before
   calling `createDesktopApp` (it is only read inside functions, never at module
   top level).
2. The module-level `mainWindow` leaks across tests — use `vi.resetModules()` +
   dynamic `import` in `beforeEach` for a fresh module each test.
3. `test/bundle.test.ts` already bundles the runtime via esbuild (CJS) — that
   covers bundling, not behavior; this plan is about behavior.

Repo conventions: English code comments; tests use real temp dirs (pattern:
`test/setup.test.ts` `createProject` helper); vitest globals imported explicitly.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Single test file | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `test/runtime/index.test.ts` (create — the only file you modify)

**Out of scope**:
- `src/runtime/index.ts` and all other source files. This plan changes zero
  production code. If a test "fails" against current source, that is a finding —
  record it in the plan status and STOP, do not "fix" the source.
- No coverage tooling, no new devDependencies.

## Git workflow

- Branch: `advisor/002-runtime-execution-tests`
- Commit: `test: 为主进程 runtime 增加执行测试，钉住路径遏制与导航加固语义`

## Steps

### Step 1: Build the electron mock harness

Create `test/runtime/index.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, ...args: any[]) => unknown>(),
  protocolHandlers: new Map<string, (request: Request) => Promise<Response>>(),
  windowOptions: undefined as Record<string, any> | undefined,
  window: undefined as any,
  openExternalUrls: [] as string[],
  quit: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  registerSchemes: vi.fn(),
}))

let userDataPath = ''
const tempDirs: string[] = []

vi.mock('electron', () => {
  class FakeWebContents extends EventEmitter {
    setWindowOpenHandler = vi.fn()
    openDevTools = vi.fn()
  }
  class FakeBrowserWindow extends EventEmitter {
    webContents = new FakeWebContents()
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
    focus = vi.fn()
    show = vi.fn()
    restore = vi.fn()
    isMinimized = vi.fn(() => false)
    constructor(options: Record<string, any>) {
      super()
      state.windowOptions = options
      state.window = this
    }
  }
  return {
    app: {
      getPath: vi.fn(() => userDataPath),
      setName: vi.fn(),
      requestSingleInstanceLock: state.requestSingleInstanceLock,
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: state.quit,
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: { handle: (channel: string, handler: any) => state.ipcHandlers.set(channel, handler) },
    protocol: {
      registerSchemesAsPrivileged: state.registerSchemes,
      handle: (scheme: string, handler: any) => state.protocolHandlers.set(scheme, handler),
    },
    shell: {
      openExternal: vi.fn(async (url: string) => { state.openExternalUrls.push(url) }),
      openPath: vi.fn(async () => ''),
    },
    Menu: { buildFromTemplate: vi.fn((t: any) => t) },
    Tray: class { setContextMenu = vi.fn(); setToolTip = vi.fn(); on = vi.fn() },
  }
})
```

`userDataPath` is a module-scope `let` assigned in `beforeEach` — the mock factory
closes over the variable slot, not its value. `savedRoot()` in the runtime is
`join(app.getPath('userData'), 'uni-desktop-files')`, i.e.
`join(userDataPath, 'uni-desktop-files')` here.

`beforeEach` / `afterAll`:

```ts
let runtime: typeof import('../../src/runtime/index')

beforeEach(async () => {
  vi.resetModules()
  state.ipcHandlers.clear()
  state.protocolHandlers.clear()
  state.windowOptions = undefined
  state.window = undefined
  state.openExternalUrls = []
  state.quit.mockClear()
  state.registerSchemes.mockClear()
  state.requestSingleInstanceLock.mockReturnValue(true)
  userDataPath = await mkdtemp(join(tmpdir(), 'uni-desktop-runtime-'))
  tempDirs.push(userDataPath)
  vi.stubGlobal('__dirname', join(userDataPath, 'electron'))
  runtime = await import('../../src/runtime/index')
})

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})
```

A `baked` fixture helper (keep `updater: false` and `tray: false` so the
electron-updater dynamic import and Tray are never touched):

```ts
function bakedFixture() {
  return {
    appName: 'runtime-test-app',
    appId: 'desktop.uniapp.runtime-test-app',
    version: '1.0.0',
    window: { title: 'Runtime Test', width: 420, height: 760, center: true, resizable: true, fullscreen: false, frame: true, autoHideMenuBar: true, show: true, alwaysOnTop: false, kiosk: false },
    dev: { openDevtools: false },
    tray: false,
    updater: false,
    icon: 'icon.png',
  }
}
```

And a boot helper: `createDesktopApp(bakedFixture())` then
`await vi.waitFor(() => expect(state.protocolHandlers.has('desktop-file')).toBe(true))`
(the whenReady work is scheduled asynchronously).

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → suite runs (may be empty), exit 0.

### Step 2: IPC handler characterization tests

Describe block `'saved-file ipc handlers'`. Invoke handlers as
`state.ipcHandlers.get('desktop:uni:saveFile')!({}, payload)`.

1. `saveFile writes bytes into the managed directory` — payload
   `{ bytes: new TextEncoder().encode('png-bytes'), mime: 'image/png' }` → result
   `{ savedFilePath }` starts with `desktop-file://f/`; exactly one file exists in
   `savedRoot()` ending `.png`; `runtime.parseDesktopFileUrl(savedFilePath)`
   decodes to a path inside `savedRoot()`.
2. `saveFile rejects non-bytes payloads` — `{ bytes: 'nope' }` rejects; `null`
   payload rejects.
3. `getSavedFileInfo and removeSavedFile reject paths outside the managed directory` —
   real file at `join(userDataPath, 'outside.txt')` (outside savedRoot), invoke
   both channels with it → both reject with `'outside the managed directories'`.
4. `removeSavedFile rejects traversal via a desktop-file url` —
   `handler({}, { filePath: 'desktop-file://f/' + encodeURIComponent('../../etc') })`
   rejects (realpath + containment defeats it).
5. `removeSavedFile rejects a symlink escaping the root` — real target
   `join(userDataPath, 'outside.txt')`, symlink `savedRoot()/link.txt` → it →
   invoke with the link path → rejects.
6. `openDocument opens a contained file` — write `savedRoot()/doc.txt`; get the
   mocked shell: `const electron = await import('electron')`;
   `vi.mocked(electron.shell.openPath).mockResolvedValueOnce('')` → handler
   resolves `{}`; then `mockResolvedValueOnce('access denied')` → handler rejects
   with 'access denied'.
7. `handlers reject non-object payloads` — `'str'` and `[1]` reject on
   `getSavedFileInfo`.

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → all pass.

### Step 3: Protocol handler characterization tests

Describe block `'desktop-file protocol'`, handler =
`state.protocolHandlers.get('desktop-file')!`:

1. `serves a file inside the root with its content type` — write
   `savedRoot()/pic.png`; `handler(new Request(runtime.toDesktopFileUrl(filePath)))`
   → status 200, body bytes match
   (`new Uint8Array(await response.arrayBuffer())`), header `content-type` is
   `image/png`.
2. `404 for a missing file` — URL of a nonexistent path → status 404.
3. `403 for a file outside the root` — real file outside savedRoot → status 403.
4. `404 for a malformed url` — `new Request('desktop-file://f/')` → status 404.

If `new Request('desktop-file://...')` throws in the environment, fall back to
passing `{ url: runtime.toDesktopFileUrl(filePath) } as Request`-shaped objects
and note that in a comment next to the helper.

**Verify**: same command as Step 2.

### Step 4: Navigation characterization tests

Describe block `'navigation hardening'`. `devUrl` is read from
`process.env.DESKTOP_DEV_URL` at window creation — use `vi.stubEnv('DESKTOP_DEV_URL', 'http://localhost:5173')`
/ `vi.unstubAllEnvs()` per test (stub before `createDesktopApp`).

1. `packaged mode allows file navigation (current prefix semantics)` — no env →
   emit `state.window.webContents.emit('will-navigate', event, 'file:///any/where/index.html')`
   with `event = { preventDefault: vi.fn() }` → `preventDefault` NOT called.
   Comment: `// Pinned deliberately; plan 003 scopes this to the app web dir.`
2. `dev mode navigates within the dev url` — env set → navigate to
   `http://localhost:5173/page` → not prevented.
3. `dev mode blocks and opens other urls` — navigate to `https://example.com` →
   `event.preventDefault` called, `state.openExternalUrls` contains the url.
4. `window open handler denies external urls` — the captured
   `setWindowOpenHandler` mock's first call arg is the callback; invoke it with
   `{ url: 'https://example.com' }` → `{ action: 'deny' }` + openExternal recorded.
5. Window creation sanity: `windowOptions.webPreferences` matches
   `{ preload: join(userDataPath, 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false }`;
   `loadFile` called with `join(userDataPath, 'electron', '..', 'web', 'index.html')`
   (read `state.window.loadFile.mock.calls`).

**Verify**: same command as Step 2.

### Step 5: Single-instance and boot ordering tests

Describe block `'app lifecycle'`:

1. `quits when another instance holds the lock` —
   `state.requestSingleInstanceLock.mockReturnValue(false)` → `createDesktopApp`
   → `state.quit` called, `state.windowOptions` stays undefined.
2. `registers the privileged scheme before ready` — after boot,
   `state.registerSchemes` was called with
   `[{ scheme: 'desktop-file', privileges: { secure: true, supportFetchAPI: true, stream: true } }]`.

**Verify**: `pnpm test` → all existing tests still pass plus the new suite.

## Test plan

This plan *is* the test plan: one new file `test/runtime/index.test.ts`, ~15
tests across 3 describe blocks. Structural pattern: temp-dir-per-test like
`test/setup.test.ts`; electron boundary mocked like `test/driver.test.ts` mocks
`../src/orchestrate/pack`.

## Done criteria

- [ ] `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → all pass
- [ ] `pnpm test` exits 0 (no other test affected)
- [ ] `pnpm typecheck && pnpm lint` exit 0
- [ ] `git status --short` shows only `test/runtime/index.test.ts` (new) and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- A characterization test fails against unmodified source (that is a real
  discovery — report which behavior differs from the excerpts above).
- `vi.stubGlobal('__dirname', ...)` does not make the module importable (report
  the actual error).
- The custom-scheme `Request` is unusable even with the Step-3 fallback shape.

## Maintenance notes

- Plans 003 (navigation hardening), 004 (disconnect guard), 005 (extension),
  010 (baked config trim), 015 (payload limits) all edit this file — they must
  update the relevant pins consciously, not delete them.
- If `src/runtime/index.ts` grows another module-level singleton, prefer the
  `vi.resetModules()` pattern over state surgery.
- Reviewer scrutiny: containment tests (2.3–2.5) and the 403 protocol test are
  the load-bearing security pins — they must not be weakened.
