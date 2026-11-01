# Plan 004: Move the dev IPC disconnect guard into createDesktopApp

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/templates/main.ts src/runtime/index.ts test/runtime/index.test.ts`
> If those files changed since this plan was written, read them live; plan 002
> must have landed first (its test file is extended here).

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-runtime-execution-tests.md
- **Category**: bug
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

In dev the Electron shell is spawned detached (`src/vite/driver.ts:82`) with an
IPC channel on the fourth stdio stream; the only thing that quits the shell when
the uni dev process dies is `process.on('disconnect', () => app.quit())` — and
that handler lives **only in the default template** (`src/templates/main.ts:12`).
The README's documented custom-main path (`## 自定义主进程`, `desktop/main.ts`
calling `createDesktopApp`) does not include it, so users following the README
get an orphaned Electron window whenever `uni dev` exits — directly contradicting
the README's promise 「uni 进程退出时壳自动关闭，不会残留孤儿窗口」. Runtime
ownership is the robust fix: every main process built on `createDesktopApp`
inherits the guard, and the template loses a copy that can drift.

## Current state

`src/templates/main.ts` (whole file, 14 lines):

```ts
import type { BakedDesktopConfig } from '../baked'
import process from 'node:process'
import { app } from 'electron'
import { createDesktopApp } from '../runtime/index'

declare const __DESKTOP_CONFIG__: BakedDesktopConfig

// In dev the shell is launched from the uni process with an IPC channel on the
// fourth stdio stream; when that process dies the channel closes and the shell
// must quit instead of lingering as an orphan window. Production launches have
// no IPC channel, so this never fires there.
process.on('disconnect', () => app.quit())

createDesktopApp(__DESKTOP_CONFIG__)
```

`src/runtime/index.ts` — `createDesktopApp` (line 292) registers the protocol,
IPC handlers, `app.setName`, the single-instance lock and lifecycle listeners;
it never touches `process.on('disconnect')`. Packaged apps have no IPC channel,
so a `disconnect` handler registered unconditionally never fires there (same
reasoning as the template comment above).

`test/runtime/index.test.ts` (from plan 002) mocks `electron` and boots via
`createDesktopApp` — extend it here.

README `## 自定义主进程` shows the custom entry and lists what
`createDesktopApp` handles; that list must gain the disconnect guard line.

House rules: English comments; the guard must be registered once even if
`createDesktopApp` were called twice (a module-level flag, not an abstraction).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Single test file | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `src/runtime/index.ts` (add the guard inside `createDesktopApp`)
- `src/templates/main.ts` (remove the now-duplicated guard)
- `test/runtime/index.test.ts` (new test)
- `README.md` (one line in 自定义主进程)

**Out of scope**:
- `src/vite/driver.ts` (spawn mechanics are correct as-is)
- Public API surface (no exported symbol changes → no tsnapi snapshot update)

## Git workflow

- Branch: `advisor/004-runtime-disconnect-guard`
- Commit: `fix: 将 dev 断连守卫移入 createDesktopApp，自定义主进程不再产生孤儿窗口`

## Steps

### Step 1: Register the guard in `createDesktopApp`

In `src/runtime/index.ts`, add a module-level flag next to `protocolRegistered`
(line ~97) and register the listener at the top of `createDesktopApp`, before
`registerDesktopFileProtocol()`:

```ts
let disconnectGuardRegistered = false
```

```ts
export function createDesktopApp(baked: BakedDesktopConfig): void {
  // In dev the shell is launched from the uni process with an IPC channel on
  // the fourth stdio stream; when that process dies the channel closes and the
  // shell must quit instead of lingering as an orphan window. Production
  // launches have no IPC channel, so this never fires there.
  if (!disconnectGuardRegistered) {
    disconnectGuardRegistered = true
    process.on('disconnect', () => app.quit())
  }
  registerDesktopFileProtocol()
  // ... rest unchanged
}
```

`process` is already imported (`import process from 'node:process'` — verify the
import exists at the top; add it if not).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Remove the duplicate from the template

In `src/templates/main.ts`, delete the `process.on('disconnect', ...)` line, the
`import process from 'node:process'` line, and move the explanatory comment to
Step 1's location (it is reproduced there — the template keeps no stale copy).
The template becomes: import baked type, import app, declare
`__DESKTOP_CONFIG__`, `createDesktopApp(__DESKTOP_CONFIG__)`.

**Verify**: `pnpm build && pnpm exec vitest run test/bundle.test.ts` → still all
pass (the bundled template now gets the guard transitively from the runtime).

### Step 3: Pin it with a test

In `test/runtime/index.test.ts`, describe block `'app lifecycle'`, add:

```ts
it('quits when the dev ipc channel disconnects', async () => {
  boot()
  process.emit('disconnect')
  expect(state.quit).toHaveBeenCalled()
})
```

(`boot()` is the Step-1 helper from plan 002. `process.emit('disconnect')`
exercises the registered listener without a real IPC channel.) Add a second
assertion in the same test: emitting `disconnect` twice still calls `quit`
(twice is fine — Electron ignores repeat quits; do NOT assert "only once").

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → all pass.

### Step 4: README

In `README.md` section `## 自定义主进程`, the bullet list after 「`createDesktopApp`
内部处理：…」 — the list mentions 单实例锁 / 导航加固 / 图标路径. Add one bullet:

> - dev 断连自护：uni dev 进程退出时自动关闭窗口，不会残留孤儿进程（自定义主进程同样生效）

**Verify**: `pnpm lint` → exit 0.

### Step 5: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

- One new test in `test/runtime/index.test.ts` (Step 3).
- `test/bundle.test.ts` (unchanged) still passes — it bundles the template, so
  this also verifies the template→runtime chain still carries the guard.

## Done criteria

- [ ] `grep -n "disconnect" src/runtime/index.ts` shows the guard in `createDesktopApp`
- [ ] `grep -n "disconnect" src/templates/main.ts` → no matches
- [ ] `pnpm test` exits 0 including the new lifecycle test
- [ ] README 自定义主进程 section contains the new bullet
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `process.emit('disconnect')` in vitest kills the test process instead of
  invoking the listener (report; the fallback is asserting via a spy on
  `process.on` that the listener was registered, but try emit first).
- The driver's spawn mechanics changed since `f02be02` such that the fourth
  stdio channel is no longer how the shell detects uni death.

## Maintenance notes

- If a future feature needs "keep running after uni exits" (e.g. a standalone
  dev shell), this guard is the thing to make conditional — deliberately.
- Reviewer scrutiny: the guard must be inside `createDesktopApp`, not module
  top-level, so custom mains that import the runtime get it through the call.
