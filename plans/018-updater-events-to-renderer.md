# Plan 018: Surface update state to the renderer via uni.getUpdateManager

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/runtime/index.ts src/shim/ src/templates/preload.ts src/vite/index.ts test/runtime/index.test.ts`
> If those changed, read them live. Plans 001 (updater bundling), 002 (runtime
> harness), 005/015 (saveFile handler), 017 (window channels) all touch this
> area — merge order matters, see Depends on.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (first main→renderer event direction in the SDK)
- **Depends on**: plans/001-fix-packaged-updater.md (without it the updater is
  dead in packaged apps and these events never fire); plans/002
  (runtime test harness); plans/017 (establishes the non-`shimChannels` channel
  group pattern — coordinate if both land)
- **Category**: direction
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`updater` config produces no user-visible moment: `setupUpdater`
(`src/runtime/index.ts:268-286`) attaches exactly one listener
(`update-downloaded`) that writes a line to the main-process logger — invisible
to end users of a packaged app. There is no `webContents.send` anywhere in
`src/` (verified by grep), no `quitAndInstall` path, and with README-documented
`autoDownload: false` nothing ever downloads again after the boot-time
`checkForUpdates()` because no renderer can trigger one. Every Electron app
user notices this gap immediately. Mapping onto uni's standard
`uni.getUpdateManager()` shape (`onCheckForUpdate` / `onUpdateReady` /
`onUpdateFailed` / `applyUpdate`) keeps the product promise — users write
`uni.xxx` with zero cross-platform changes. Verified during the audit:
`getUpdateManager` does not exist in uni-h5 (0 occurrences in the example's
`uni-h5.es.js`), so bridging it is inside the repo's own "only H5-unimplemented
APIs" shim rule.

## Current state

- `src/runtime/index.ts:268-286` — `setupUpdater`: dynamic
  `import('electron-updater')` (bundled after plan 001), sets `autoDownload` /
  `autoInstallOnAppQuit` from baked config, one `update-downloaded` listener →
  `logger.success('update downloaded, it will be installed on quit')`, then
  `await autoUpdater.checkForUpdates()`; all failures → `logger.warn('auto update unavailable: ...')`.
- `src/shim/channels.ts` — `shimChannels` (uni-API channels; the vite plugin
  derives wrapper exports from these keys) and `allShimChannels` (the preload
  allowlist, merged with `windowChannels` after plan 017).
- `src/templates/preload.ts` — exposes ONLY `invoke(channel, payload)`; there is
  no subscription mechanism, so main→renderer events need a preload addition.
- `src/shim/patch.ts` — `patchUni` assigns desktop implementations onto the uni
  object; `src/shim/apis/index.ts` re-exports them; the wrapper export list is
  derived from `Object.keys(shimChannels)` minus `openDocument`
  (`src/vite/index.ts:27`).
- uni `getUpdateManager` spec (the shape to implement): returns a manager with
  `onCheckForUpdate(cb)`, `onUpdateReady(cb)`, `onUpdateFailed(cb)`, and
  `applyUpdate()`. Callbacks receive `{ errMsg }`-style payloads; uni docs
  describe `updateReady` with `version`/`description` when available.

House rules: deny-by-default allowlist; uni-style errors via
`src/shim/result.ts` `invokeUniApi`; no abstraction beyond one renderer module +
one runtime wiring function.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shim tests | `pnpm build && pnpm exec vitest run test/shim/` | all pass |
| Runtime tests | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/shim/channels.ts` (`getUpdateManager` invoke channel + an updater event
  channel)
- `src/shim/apis/update-manager.ts` (create) + `src/shim/apis/index.ts`,
  `src/shim/patch.ts` (register on the uni object)
- `src/templates/preload.ts` (a minimal `onUpdaterEvent` subscription hook)
- `src/runtime/index.ts` (event forwarding + `applyUpdate` + get-manager-state handler)
- Tests: `test/shim/update-manager.test.ts` (create), `test/runtime/index.test.ts`
- `README.md` (自动更新 section + shim table row)

**Out of scope**:
- No `download-progress` event (electron-updater supports it; uni's
  `getUpdateManager` does not define it — keep the uni shape).
- No silent re-check scheduling; the boot check stays the only automatic one.
- No updater UI components — the shim delivers state; rendering is the app's job.

## Git workflow

- Branch: `advisor/018-updater-events-to-renderer`
- Commit: `feat: 更新状态桥接渲染层，垫片提供 uni.getUpdateManager`

## Steps

### Step 1: Channels

`src/shim/channels.ts`:

- Add to `shimChannels` (uni-API channel group → wrapper export + patch, like
  the saved-file APIs):
  `getUpdateManager: 'desktop:uni:getUpdateManager'`.
- Add to `windowChannels`'s pattern — a third group (or extend `windowChannels`;
  prefer a separate named group for clarity):

```ts
/** Main→renderer updater events; main pushes, the preload hook delivers. */
export const updaterEventChannel = 'desktop:updater:event'
```

Do NOT put `updaterEventChannel` into an invoke allowlist — it is a
subscription channel; the preload gates it explicitly (Step 3).

**Verify**: `pnpm build && pnpm exec vitest run test/vite.test.ts test/bundle.test.ts` → pass
(wrapper now also re-exports `getUpdateManager` — bundle output assertions
still hold).

### Step 2: Runtime wiring

In `src/runtime/index.ts`:

- Track the window for event delivery: in `createMainWindow`, after
  `mainWindow.on('closed', ...)` nothing needed — `getMainWindow()` suffices.
- Rework `setupUpdater` (rename to `setupUpdater(baked)` unchanged) to forward
  events. Target shape:

```ts
type UpdaterEvent =
  | { type: 'checkForUpdate' }
  | { type: 'updateAvailable' }
  | { type: 'updateNotAvailable' }
  | { type: 'updateReady', version?: string }
  | { type: 'updateFailed', message: string }

let lastUpdaterEvent: UpdaterEvent | undefined
const updaterListeners = new Set<WebContents>()
```

Hmm — WebContents import/type: use the inferred type via `Electron.WebContents`
or store `webContents` objects loosely typed as
`Parameters<...>`. Concretely (keep it simple and typed):

```ts
import type { WebContents } from 'electron'
```

```ts
function sendUpdaterEvent(event: UpdaterEvent): void {
  lastUpdaterEvent = event
  for (const webContents of updaterListeners)
    if (!webContents.isDestroyed())
      webContents.send(updaterEventChannel, event)
}
```

In `setupUpdater`'s try block, wire:
`autoUpdater.on('checking-for-update', () => sendUpdaterEvent({ type: 'checkForUpdate' }))`,
`'update-available'` → `updateAvailable`, `'update-not-available'` →
`updateNotAvailable`, `'update-downloaded'` →
`{ type: 'updateReady', version: autoUpdater.currentVersion?.version }` (keep
the existing logger.success line too), `'error'` →
`{ type: 'updateFailed', message: error.message }` (keep the existing warn).
Late subscribers get the last event on subscribe (Step 3's get-state handler
returns it).

- New IPC handlers in `registerIpcHandlers`:

```ts
  ipcMain.handle(shimChannels.getUpdateManager, async () => {
    return { event: lastUpdaterEvent ?? null }
  })
```

Wait — `getUpdateManager` is not an invoke-style uni API; it *returns a manager
object*. The renderer shim implements the manager locally (Step 3); the main
side only needs: (a) the event push, and (b) `applyUpdate`. So the invoke
channel should be `applyUpdate`, not `getUpdateManager`. Revise:
`shimChannels` gains `applyUpdate: 'desktop:uni:applyUpdate'`; the handler:

```ts
  ipcMain.handle(shimChannels.applyUpdate, async () => {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.quitAndInstall()
  })
```

If electron-updater is unavailable (pure browser has no bridge — unreachable;
updater disabled → the dynamic import still succeeds since it is bundled — but
`quitAndInstall` without a downloaded update quits and does nothing). Guard:
only quit when `lastUpdaterEvent?.type === 'updateReady'`, else throw
`no downloaded update` (surfaces as `applyUpdate:fail ...`).

- Subscription registry: handlers to register/unregister listeners. The preload
  hook (Step 3) needs a main-side pairing: implement it as an invoke pair —
  simplest robust design: the preload passes the *event* through a plain
  `ipcRenderer.on(updaterEventChannel, ...)` — NO allowlist needed for `on`
  because `invoke` is the only gated surface; receiving is not renderer-initiated.
  Decision: the preload adds a dedicated `onUpdaterEvent(callback)` that does
  `ipcRenderer.on(updaterEventChannel, (_e, event) => callback(event))` — no
  channel registry, no main-side subscription bookkeeping, `lastUpdaterEvent`
  covers late subscribers via the applyUpdate... no — late subscribers need the
  last event: preload's `onUpdaterEvent` cannot fetch it. Add it to the
  applyUpdate sibling: rename the invoke channel to
  `desktop:updater:state` returning `{ event: lastUpdaterEvent ?? null }`, and
  `applyUpdate: 'desktop:uni:applyUpdate'` for quitAndInstall. Both go in a
  new `updaterChannels` group appended to `allShimChannels`.

Final channel shape (write this):

```ts
export const updaterChannels = {
  state: 'desktop:updater:state',
  applyUpdate: 'desktop:uni:applyUpdate',
} as const
```

`shimChannels` gains nothing; the wrapper export comes from
`src/shim/apis/index.ts` re-exporting `getUpdateManager` (Step 3) — BUT the
vite wrapper derives exports from `Object.keys(shimChannels)`; `getUpdateManager`
must appear there or the compiled path loses it. Resolution: add
`getUpdateManager: 'desktop:uni:getUpdateManager'` to `shimChannels` AND make
its main-side handler return `{ event: lastUpdaterEvent ?? null }` (the state
fetch). Then `updaterChannels` only holds `applyUpdate` (invoke) and the
preload's `onUpdaterEvent` uses the raw `updaterEventChannel` constant. This
keeps one uni-API → one `shimChannels` key mapping intact.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Renderer shim

Create `src/shim/apis/update-manager.ts`:

```ts
import { getBridgeOrThrow } from '../bridge'
import { shimChannels, updaterChannels, updaterEventChannel } from '../channels'
import { invokeUniApi } from '../result'

interface UpdaterEvent { type: string, version?: string, message?: string }

/**
 * Desktop `uni.getUpdateManager()`: uni-spec shape over the electron-updater
 * bridge. Pure-browser opens have no bridge — the factory returns undefined
 * and `patchUni` skips it, matching uni-h5's missing implementation.
 */
export function getUpdateManager(): {
  onCheckForUpdate: (cb: (res: any) => void) => void
  onUpdateReady: (cb: (res: any) => void) => void
  onUpdateFailed: (cb: (res: any) => void) => void
  applyUpdate: () => Promise<unknown> | undefined
} | undefined {
  const bridge = getBridge()
  if (!bridge)
    return undefined
  const listeners: Record<string, ((res: any) => void)[]> = { checkForUpdate: [], updateReady: [], updateFailed: [] }
  const deliver = (event: UpdaterEvent): void => {
    if (event.type === 'checkForUpdate') listeners.checkForUpdate.forEach(cb => cb({ errMsg: 'ok' }))
    else if (event.type === 'updateReady') listeners.updateReady.forEach(cb => cb({ errMsg: 'ok', version: event.version }))
    else if (event.type === 'updateFailed') listeners.updateFailed.forEach(cb => cb({ errMsg: event.message ?? 'fail' }))
  }
  // Register through the preload hook, then pull the last event (late subscribe).
  void (globalThis as any).__UNI_DESKTOP_ON_UPDATER__?.(deliver)
  void bridge.invoke(updaterChannels.state).then((res) => {
    const event = (res as any)?.event
    if (event)
      deliver(event)
  })
  return {
    onCheckForUpdate: cb => { listeners.checkForUpdate.push(cb) },
    onUpdateReady: cb => { listeners.updateReady.push(cb) },
    onUpdateFailed: cb => { listeners.updateFailed.push(cb) },
    applyUpdate: () => invokeUniApi('applyUpdate', {}, async () => {
      await bridge.invoke(updaterChannels.applyUpdate)
      return {}
    }),
  }
}
```

(Refine the types while implementing; the shape above is the contract.) Register
it in `patchUni` (`uni.getUpdateManager = getUpdateManager` — note: unlike the
other patched APIs this one is a factory; patchUni assigns it as-is, matching
uni's call pattern `uni.getUpdateManager()`) and re-export from
`src/shim/apis/index.ts`. In `src/shim/apis/index.ts`, also export it so the
vite wrapper's `SAVED_FILE_APIS` derivation includes it automatically (it
derives from `Object.keys(shimChannels)` — `getUpdateManager` is there).

Preload (`src/templates/preload.ts`): add the hook next to `invoke`:

```ts
  onUpdaterEvent: (callback: (event: unknown) => void): void => {
    ipcRenderer.on(updaterEventChannel, (_event, payload) => callback(payload))
  },
```

importing `updaterEventChannel` from `'@uni-helper/desktop/shim/channels'` (the
preload already imports `allShimChannels` from there). Update the renderer
shim's Step-3 code to use `getBridge()?.onUpdaterEvent?.(...)` — extend
`DesktopBridge` in `src/shim/types.ts` with the optional method instead of the
`globalThis` poke in the sketch.

**Verify**: `pnpm build && pnpm exec vitest run test/shim/ test/bundle.test.ts` → pass
(`bundle.test.ts` asserts preload contains specific channels; add nothing there
yet).

### Step 4: Tests

- `test/shim/update-manager.test.ts` (new, happy-dom): bridge mock; assert
  factory returns undefined without a bridge; callbacks fire from a pushed
  event; `applyUpdate` invokes `desktop:uni:applyUpdate` and surfaces
  `applyUpdate:fail` on rejection; late subscribe pulls the last event via the
  state channel.
- `test/runtime/index.test.ts`: with `updater: false` nothing changes (existing
  pins). Add a focused unit for `sendUpdaterEvent`-behavior indirectly is hard
  (setupUpdater is not exported and needs electron-updater) — instead pin the
  `getUpdateManager` state handler: invoke `shimChannels.getUpdateManager`
  handler → `{ event: null }` when no updater ran.
- `test/bundle.test.ts`: extend the preload assertion to include
  `desktop:updater:event`.

**Verify**: `pnpm test` → all pass.

### Step 5: README

- Shim table: add row `| uni.getUpdateManager | 未实现 | 返回 uni 规范的更新管理器，桥接 electron-updater 事件；纯浏览器环境返回 undefined |`.
- `## 自动更新` section: add a paragraph documenting the renderer surface with a
  short example (`const mgr = uni.getUpdateManager(); mgr.onUpdateReady(() => ...)`),
  and note `applyUpdate` triggers `quitAndInstall`.

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

New shim test file + one runtime handler pin + one bundle assertion (Step 4).
The updater event wiring itself stays exercised only in real dev (electron-updater
mocking at that depth is out of scope) — note this in the PR description.

## Done criteria

- [ ] `grep -n "getUpdateManager" src/shim/channels.ts src/shim/patch.ts src/shim/apis/index.ts` matches all three
- [ ] `grep -n "updaterEventChannel" src/templates/preload.ts` matches
- [ ] `pnpm test` exits 0 with the new tests
- [ ] README documents the surface
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- electron-updater's event names differ from
  `checking-for-update`/`update-available`/`update-not-available`/`update-downloaded`/`error`
  (read the installed package's `.d.ts` live before wiring; report if the set
  differs).
- The vite wrapper derivation starts re-exporting `applyUpdate` as a uni API
  (means the channel leaked into `shimChannels` — fix placement).

## Maintenance notes

- This introduces the SDK's first main→renderer push; any future push (tray
  clicks, window state) should reuse the `onUpdaterEvent` hook pattern under a
  renamed generic (`onDesktopEvent`).
- Reviewer scrutiny: the preload still cannot send arbitrary channels; the only
  new renderer-triggered invocations are `state`/`applyUpdate`, both allowlisted.
