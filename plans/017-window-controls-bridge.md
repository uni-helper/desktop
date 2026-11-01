# Plan 017: Ship a window-control bridge for frameless/custom-titlebar windows

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/shim/channels.ts src/shim/index.ts src/templates/preload.ts src/runtime/index.ts src/vite/index.ts test/runtime/index.test.ts test/shim/install.test.ts`
> If those changed, read them live. Plans 002–005/015 touch the runtime and its
> test file — read the live files regardless.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: plans/002-runtime-execution-tests.md (harness to pin the new handlers)
- **Category**: direction
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The product accepts `frame: false` / `titleBarStyle: 'hidden' | 'hiddenInset'`
(`src/types.ts:36-37`) — i.e. it encourages frameless, custom-titlebar windows —
and the README's 条件编译 section even shows a `#ifdef DESKTOP` 最小化窗口 button
as the showcase. But nothing can control the window: the five IPC channels are
all file APIs (`src/shim/channels.ts:7-13`), the preload allowlists only those,
and a full grep of `src/` finds no `minimize`/`maximize`/`webContents.send` at
all. A user who configures a hidden title bar gets a window they cannot move,
minimize or close from their app UI, with no escape hatch short of writing their
own main process — the exact thing the SDK exists to avoid. Given the bridge
architecture, this is one channel-group + three handlers + one small renderer
helper.

## Current state

- `src/shim/channels.ts`:
  ```ts
  export const shimChannels = {
    saveFile: 'desktop:uni:saveFile',
    getSavedFileList: 'desktop:uni:getSavedFileList',
    getSavedFileInfo: 'desktop:uni:getSavedFileInfo',
    removeSavedFile: 'desktop:uni:removeSavedFile',
    openDocument: 'desktop:uni:openDocument',
  } as const
  export type ShimChannel = (typeof shimChannels)[keyof typeof shimChannels]
  export const allShimChannels: ShimChannel[] = Object.values(shimChannels)
  ```
- `src/templates/preload.ts` allowlists exactly `allShimChannels` and exposes one
  `invoke` on `window.__UNI_DESKTOP_BRIDGE__`.
- `src/runtime/index.ts` `registerIpcHandlers` (line 122) registers the file
  handlers; `getMainWindow()` (line 28) returns the singleton window.
- `src/vite/index.ts:27` — `SAVED_FILE_APIS = Object.keys(shimChannels).filter(name => name !== 'openDocument')`
  is re-exported from the uni-h5 wrapper. **Window channels must NOT enter
  `shimChannels`**, or they would become bogus wrapper exports — use a separate
  group.
- The preload allowlist and `allShimChannels` are the only places a new channel
  must register; renderer helpers live in `src/shim/apis/` and are re-exported
  from `src/shim/apis/index.ts`.

House rules: deny-by-default allowlist stays; window controls act on the
existing main window only; no new public subpath export — the helper ships from
the existing `@uni-helper/desktop/shim` surface.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shim tests | `pnpm build && pnpm exec vitest run test/shim/` | all pass |
| Runtime tests | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| Vite plugin tests | `pnpm build && pnpm exec vitest run test/vite.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/shim/channels.ts` (new `windowChannels` group + merged allowlist)
- `src/shim/apis/window-controls.ts` (create) + `src/shim/apis/index.ts` (re-export)
- `src/shim/index.ts` (export the helper — read the file first; it currently
  exports `installDesktopShim`; add the helper export)
- `src/runtime/index.ts` (three handlers)
- `test/runtime/index.test.ts` (handler pins), `test/shim/window-controls.test.ts`
  (create, modeled on `test/shim/apis.test.ts`)
- `README.md` (垫片章节 + 条件编译 example made real)

**Out of scope**:
- Do NOT add `uni.minimizeWindow` etc. — not uni spec APIs; the helper is
  desktop-only and explicitly namespaced (see Step 3).
- No drag-region CSS injection, no `isMaximized` event streaming (pull-only for
  now), no multi-window targeting.
- `SAVED_FILE_APIS` derivation in `src/vite/index.ts` stays untouched — verify
  it does not pick up window channels (that is why Step 1 uses a separate object).

## Git workflow

- Branch: `advisor/017-window-controls-bridge`
- Commit: `feat: 窗口控制桥（最小化/最大化还原/关闭），无边框窗口可操作`

## Steps

### Step 1: Channels

`src/shim/channels.ts`:

```ts
/**
 * Window-control channels for frameless / custom-titlebar windows. Deliberately
 * separate from `shimChannels`: the vite plugin derives the uni-h5 wrapper
 * exports from those keys, and window controls are not uni APIs.
 */
export const windowChannels = {
  minimize: 'desktop:window:minimize',
  toggleMaximize: 'desktop:window:toggleMaximize',
  close: 'desktop:window:close',
} as const

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels]

export const allShimChannels: ShimChannel[] = [
  ...Object.values(shimChannels),
  ...Object.values(windowChannels),
]
```

(`allShimChannels` replaces the current line — the preload allowlist picks the
new channels up automatically.)

**Verify**: `pnpm build && pnpm exec vitest run test/shim/ test/vite.test.ts` → all pass
(`test/bundle.test.ts` asserts specific channels in preload output — still fine).

### Step 2: Runtime handlers

In `src/runtime/index.ts` `registerIpcHandlers`, append:

```ts
  // Frameless / custom-titlebar windows need the renderer to drive the window
  // itself; handlers act on the main window and no-op silently without one.
  ipcMain.handle(windowChannels.minimize, () => {
    getMainWindow()?.minimize()
  })
  ipcMain.handle(windowChannels.toggleMaximize, () => {
    const window = getMainWindow()
    if (!window)
      return
    if (window.isMaximized())
      window.unmaximize()
    else
      window.maximize()
  })
  ipcMain.handle(windowChannels.close, () => {
    getMainWindow()?.close()
  })
```

Import `windowChannels` alongside the existing `shimChannels` import. Note:
`close()` triggers the window `'closed'` event → `mainWindow = null` — consistent
with the existing lifecycle. On macOS this closes the window without quitting
(the app stays in the Dock, `activate` recreates) — standard Electron behavior,
unchanged by this plan (plan 019 adds close-to-tray).

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → existing pins pass.

### Step 3: Renderer helper

Create `src/shim/apis/window-controls.ts`:

```ts
import { getBridge } from '../bridge'
import { windowChannels } from '../channels'

/**
 * Window controls for frameless / custom-titlebar desktop windows. Not uni
 * APIs: call them behind `#ifdef DESKTOP`, e.g.
 * `import { desktopWindow } from '@uni-helper/desktop/shim'`. No-op outside
 * the desktop shell (pure browser), like the rest of the shim.
 */
export const desktopWindow = {
  minimize: (): void => { void getBridge()?.invoke(windowChannels.minimize) },
  toggleMaximize: (): void => { void getBridge()?.invoke(windowChannels.toggleMaximize) },
  close: (): void => { void getBridge()?.invoke(windowChannels.close) },
}
```

Re-export from `src/shim/apis/index.ts` and `src/shim/index.ts` (read both
files first to match their comment style).

**Verify**: `pnpm build && pnpm exec vitest run test/shim/` → passes.

### Step 4: Tests

- `test/shim/window-controls.test.ts` (new, happy-dom header like
  `test/shim/apis.test.ts`): with a bridge mock asserting
  `invoke('desktop:window:minimize')` etc.; without a bridge, all three no-op
  without throwing.
- `test/runtime/index.test.ts`: add a `'window control handlers'` describe —
  boot (harness from plan 002), then drive `state.window`: for minimize,
  add `minimize = vi.fn()` / `isMaximized` / `maximize` / `unmaximize` /
  `close = vi.fn()` to `FakeBrowserWindow` in the harness; invoke each handler
  and assert the right method was called on `state.window`; invoke with no
  window (`state.window = undefined` after emitting `'closed'`) → handlers
  resolve without throwing.
- `test/shim/install.test.ts` / `test/vite.test.ts` must pass unchanged — they
  prove the wrapper derivation did not pick up the window channels.

**Verify**: `pnpm test` → all pass.

### Step 5: README

- In `## 垫片支持的 API`, add a short subsection after the API table:

````markdown
### 窗口控制

`frame: false` / `titleBarStyle: 'hidden'` 的无边框窗口，可用窗口控制桥驱动：

```ts
// #ifdef DESKTOP
import { desktopWindow } from '@uni-helper/desktop/shim'

desktopWindow.minimize()
desktopWindow.toggleMaximize()
desktopWindow.close()
// #endif
```

纯浏览器环境整体 no-op。
````

- In the 条件编译 section, replace the `<button @click="minimize">最小化窗口</button>`
  example's handler with a comment noting `minimize` 可用 `desktopWindow.minimize()`
  实现 (one line, keep the template block otherwise).

**Verify**: `pnpm lint && pnpm knip` → exit 0.

## Test plan

One new shim test file + one new runtime describe block (Step 4); existing
suites prove no wrapper-export leakage.

## Done criteria

- [ ] `grep -n "desktop:window:" src/shim/channels.ts src/runtime/index.ts` matches both
- [ ] `grep -n "windowChannels" src/vite/index.ts` → no matches (no wrapper leakage)
- [ ] `pnpm test` exits 0 with the new tests
- [ ] README documents the helper
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `SAVED_FILE_APIS` derivation picks up window channels in any test (means the
  channels leaked into `shimChannels` — fix the placement, not the derivation).
- `state.window` lifecycle in the runtime harness diverges from plan 002's
  description — adapt the harness carefully; report if `FakeBrowserWindow`
  needs restructuring.

## Maintenance notes

- Future window APIs (e.g. `setAlwaysOnTop`, fullscreen toggle) slot into
  `windowChannels` + one handler + one helper method — same three files.
- Reviewer scrutiny: the allowlist still denies unknown channels (the preload
  allowlist is derived, so this holds structurally); handlers no-op without a
  window instead of throwing.
