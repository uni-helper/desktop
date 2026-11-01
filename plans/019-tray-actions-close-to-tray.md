# Plan 019: Give the tray real actions and make close-to-tray possible

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/types.ts src/baked.ts src/config/resolve.ts src/runtime/index.ts test/runtime/index.test.ts`
> If those changed, read them live. Plans 004/015/017/018 also touch the runtime —
> read the live file regardless.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW–MED (touches window lifecycle on all platforms)
- **Depends on**: plans/002-runtime-execution-tests.md (harness)
- **Category**: direction
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The tray ships as a feature (README documents `tray.menu`) but can only do
built-in Electron roles: the menu item type allows `label`/`role`/`enabled`/
`visible` (`src/types.ts:67-72`) — a `click` handler is impossible because the
menu is serialized into the baked config, and the runtime hardcodes
`tray.on('click', () => show())` (`src/runtime/index.ts:261`). There is no
"open window", "check for updates" or any app action; and on Windows/Linux
`window-all-closed` quits unconditionally (`src/runtime/index.ts:330-333`), so
the standard 「关闭窗口驻留托盘」 behavior is unreachable. Users wanting real
tray behavior must fork to a custom main process.

## Current state

- `src/types.ts:67-79`:
  ```ts
  export interface DesktopTrayMenuItem {
    label?: string
    role?: string
    enabled?: boolean
    visible?: boolean
  }
  export interface DesktopTrayConfig {
    icon?: string
    tooltip?: string
    menu?: DesktopTrayMenuItem[]
  }
  ```
- `src/runtime/index.ts:254-261` — menu mapping (label/role/enabled/visible only)
  + `tray.on('click', () => getMainWindow()?.show())`.
- `src/runtime/index.ts:330-333` — `app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })`.
- `src/baked.ts` — `BakedDesktopConfig` is JSON-safe by contract (esbuild define);
  `tray` carries `menu?: DesktopTrayMenuItem[]`.
- README 配置 example shows `tray: { menu: [{ role: 'quit' }] }`.

Design decisions already made (do not re-litigate):
- Actions are a small string enum on the baked config (JSON-safe), not
  functions — an `action` field dispatches in the runtime.
- Close-to-tray is a WINDOW config (`window.closeToTray`), implemented with the
  standard `close` → `preventDefault` + `hide()` + a quitting flag; this is the
  pattern Electron documents.

House rules: enum values are closed strings; no registry; comments in English.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Runtime tests | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| Snapshot regen | `pnpm build && TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u` | snapshots updated |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/types.ts` (`DesktopTrayMenuItem.action`, `DesktopWindowConfig.closeToTray`)
- `src/runtime/index.ts` (action dispatch, close-to-tray interception, window-all-closed)
- `test/runtime/index.test.ts` (dispatch + close-to-tray pins)
- `test/__snapshots__/tsnapi/**` (regenerate)
- `README.md` (tray + window config docs)

**Out of scope**:
- No renderer API for tray clicks (a future main→renderer event can reuse plan
  018's hook pattern if ever needed).
- Do NOT change `tray.on('click')` behavior (platform context-menu quirks are
  shipped behavior; touching them is out of scope).
- Plan 010 trims the baked updater type — coordinate, don't conflict.

## Git workflow

- Branch: `advisor/019-tray-actions-close-to-tray`
- Commit: `feat: 托盘菜单支持自定义 action，窗口支持关闭驻留托盘`

## Steps

### Step 1: Types

`src/types.ts`:

```ts
/** Built-in actions a tray menu item can trigger (JSON-safe for the baked config). */
export type DesktopTrayMenuAction = 'show' | 'quit' | 'check-for-updates'

export interface DesktopTrayMenuItem {
  label?: string
  role?: string
  enabled?: boolean
  visible?: boolean
  /** Triggers the built-in action when clicked; mutually exclusive with `role` */
  action?: DesktopTrayMenuAction
}
```

And in `DesktopWindowConfig`:

```ts
  /** Hide to the tray instead of quitting when the window is closed (non-mac quit behavior) */
  closeToTray?: boolean
```

`closeToTray` flows through `ResolvedWindowConfig` — it is
`Required<Omit<...>>`-derived, so add it to the omit list like
`titleBarStyle`/`minWidth`/`minHeight`/`backgroundColor` (it stays optional in
the resolved type; `DEFAULT_WINDOW` does not need it since the runtime treats
`undefined` as false).

**Verify**: `pnpm typecheck` → fails in runtime until Step 2 (baked config passes
it through structurally — verify `bakeConfig` needs no change: `tray.menu` is
copied wholesale, `window` is `resolved.window` — both flow automatically).

### Step 2: Runtime dispatch and close-to-tray

In `src/runtime/index.ts`:

- Add a quitting flag at module scope: `let quitting = false`; in
  `createDesktopApp`, add `app.on('before-quit', () => { quitting = true })`.
- Menu mapping: extend the template mapping with `action: item.action as any`
  is wrong — instead attach the click in the mapped object:
  ```ts
  const template: MenuItemConstructorOptions[] = (trayConfig?.menu ?? [{ role: 'quit' }]).map((item) => {
    if (item.action)
      return { label: item.label, enabled: item.enabled, visible: item.visible, click: () => runTrayAction(item.action!) }
    return { label: item.label, role: item.role as MenuItemConstructorOptions['role'], enabled: item.enabled, visible: item.visible }
  })
  ```
  With:
  ```ts
  function runTrayAction(action: DesktopTrayMenuAction): void {
    if (action === 'show') {
      const window = getMainWindow()
      if (window) {
        window.show()
        window.focus()
      }
    }
    else if (action === 'quit') {
      app.quit()
    }
    else if (action === 'check-for-updates') {
      // best-effort: without updater config this is a no-op the user can diagnose
      void import('electron-updater')
        .then(({ autoUpdater }) => autoUpdater.checkForUpdates())
        .catch((error: unknown) => logger.warn('check for updates failed:', error instanceof Error ? error.message : error))
    }
  }
  ```
  (import the action type from `../types`).
- Close-to-tray in `createMainWindow`, after `hardenNavigation`:
  ```ts
  if (window.closeToTray) {
    mainWindow.on('close', (event) => {
      // Hide instead of quitting; a real quit (tray quit, Cmd+Q) sets `quitting` first.
      if (!quitting) {
        event.preventDefault()
        mainWindow?.hide()
      }
    })
  }
  ```
- `window-all-closed` unchanged — with close-to-tray the window only ever hides,
  so the event does not fire until a real quit; that is correct on all
  platforms. Verify this reasoning holds in the test for the darwin path too.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Tests

In `test/runtime/index.test.ts` (harness from plan 002; extend `FakeBrowserWindow`
with `hide = vi.fn()` if missing):

1. `tray menu actions dispatch` — needs `tray` enabled: extend the harness to
   capture `new Tray(...)` instances (`state.tray = new (class { setContextMenu = vi.fn(); setToolTip = vi.fn(); on = vi.fn() })()`-style via a hoisted array) and `Menu.buildFromTemplate` input. Boot with
   `tray: { icon: 'tray-icon.png', menu: [{ label: 'Show', action: 'show' }, { label: 'Quit', action: 'quit' }, { role: 'quit' }] }`,
   grab the template array passed to `buildFromTemplate`, invoke the first
   item's `click()` → `state.window.show` + `focus` called; second item's
   `click()` → `state.quit` called; third item has `role: 'quit'` and no
   `click`.
2. `close-to-tray hides instead of closing` — baked with
   `window: { ...bakedFixture().window, closeToTray: true }`; after boot, emit
   `state.window.emit('close', event)` with `event = { preventDefault: vi.fn() }`
   → `preventDefault` called, `state.window.hide` called. Then set the quitting
   flag by emitting the app `before-quit` — the harness's mocked `app.on`
   records listeners: extend the mock to store them (`state.appListeners`),
   emit `'before-quit'`, emit `'close'` again → NOT prevented.
3. `closeToTray absent keeps default close` — default fixture, emit `'close'`
   → not prevented.

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → all pass.

### Step 4: Snapshots + README

- Regenerate snapshots (types changed):
  `pnpm build && TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u`.
- README 配置 example: `tray.menu` entry — add
  `menu: [{ label: '打开窗口', action: 'show' }, { role: 'quit' }]` replacing the
  current `[{ role: 'quit' }]`, and in the prose below the example add:
  「菜单项可用 `action: 'show' | 'quit' | 'check-for-updates'` 触发内置行为（与 `role` 互斥）；`window.closeToTray: true` 时关闭窗口会隐藏到托盘而非退出（macOS 上 Cmd+Q 与托盘退出仍会真正退出）。」

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

Three runtime pins (Step 3) + snapshot regen. The `check-for-updates` action's
electron-updater path is best-effort and NOT unit-tested (same policy as plan 018).

## Done criteria

- [ ] `grep -n "runTrayAction" src/runtime/index.ts` matches
- [ ] `grep -n "closeToTray" src/types.ts src/runtime/index.ts` matches both
- [ ] `pnpm test` exits 0 with the new pins + regenerated snapshots
- [ ] README documents both features
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `before-quit` listener registration in the harness mock cannot capture
  handlers cleanly — extend the mock deliberately; if the harness needs
  restructuring beyond adding `appListeners`, report.
- The existing `tray.on('click')` pin in the runtime diverges from the excerpt
  (plan 017/018 landed concurrent runtime changes — read live).

## Maintenance notes

- New tray actions start as enum values here; anything needing parameters
  (e.g. "open URL") should NOT extend the enum — it belongs in a custom main.
- Reviewer scrutiny: `quitting` flag ordering (`before-quit` fires before window
  close events on quit paths — Electron guarantees this; if a platform
  contradicts, the hide-on-close would eat real quits, which the test pins).
