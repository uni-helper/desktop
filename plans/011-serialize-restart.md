# Plan 011: Serialize the dev restart lifecycle

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/vite/driver.ts test/driver.test.ts`
> If those changed, read them live.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`restartElectron` is fire-and-forget per rebuild with no mutex and no
closed-check: two quick main-process rebuilds (save-all, git checkout)
interleave — both `await killTree(...)` on the same dying process, then both
`spawnElectron()` — so two Electron instances race for the single-instance lock,
one flashes and quits, with log noise and a wasted ~250 MB launch. And closing
the dev server while a rebuild callback is in flight can spawn a fresh shell
nobody will kill (the shell is spawned `detached`, so it survives uni's exit).
After this plan, at most one spawn happens after the latest kill, and none
after `close()`.

## Current state

`src/vite/driver.ts:46-118` — `startDesktopDevRuntime` (relevant parts):

```ts
  let electronProcess: ChildProcess | undefined
  let electronStarted = false
  const spawnElectron = (): void => {
    electronProcess = spawn(launchBinary, [join(electronDir, 'main.cjs')], {...})
    electronStarted = true
    electronProcess.once('exit', (code) => { logger.info(`electron exited with code ${code}`) })
    electronProcess.once('error', (error) => { logger.error(`failed to start electron: ${error.message}`) })
  }
  async function restartElectron(): Promise<void> {
    if (!electronStarted)
      return
    await killTree(electronProcess)
    spawnElectron()
  }

  const watcher = await bundleEntry({
    entryPath: resolveMainEntry(root, resolved.mainEntry),
    outDir: electronDir,
    baked,
    watch: true,
    onRebuild: () => void restartElectron(),
  })
  await bundlePreload({ outDir: electronDir, templateDir })
  spawnElectron()

  let closed = false
  return {
    async close() {
      if (closed)
        return
      closed = true
      await Promise.all([killTree(electronProcess), watcher?.dispose()])
    },
  }
```

The `bundleEntry` watch plugin (`src/orchestrate/bundle.ts:30-51`) fires
`onRebuild` once per non-initial successful rebuild — bursts are normal
(save-all). `killTree` (`src/orchestrate/electron.ts:39`) resolves when the
process is really gone.

Existing test coverage: `test/driver.test.ts` covers `assembleDesktopApp` and
the no-electron error path only; the restart loop is untested. `test/driver.test.ts`
mocks `../src/orchestrate/pack` (`vi.mock` at lines 17–19) — extend that pattern.

House rules: a chained-promise serializer is the minimal correct shape here
(no abstraction, no queue class).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| New test file | `pnpm build && pnpm exec vitest run test/driver-restart.test.ts` | all pass |
| Existing driver tests | `pnpm build && pnpm exec vitest run test/driver.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint | `pnpm typecheck` / `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `src/vite/driver.ts` (only `startDesktopDevRuntime`'s lifecycle locals + `close`)
- `test/driver-restart.test.ts` (create)

**Out of scope**:
- `src/orchestrate/bundle.ts` watch plugin / `src/orchestrate/electron.ts` killTree — both correct as-is.
- Do not debounce rebuilds (esbuild already coalesces; the bug is the unsynchronized restart, not the burst).
- `assembleDesktopApp` untouched.

## Git workflow

- Branch: `advisor/011-serialize-restart`
- Commit: `fix: 串行化 dev 重启生命周期，修复快速重建双开与 close 后复活窗口`

## Steps

### Step 1: Add the closed-check and restart chain

In `src/vite/driver.ts`, restructure the lifecycle locals. Move `let closed = false`
UP with the other locals (before `spawnElectron`), add a chained promise, and
make `close()` await the chain. Target shape:

```ts
  // Declared before the watcher starts: a rebuild can land between the watcher
  // and the first spawn, and must then be a no-op instead of a second spawn.
  let electronProcess: ChildProcess | undefined
  let electronStarted = false
  let closed = false
  // Serialized restarts: concurrent rebuilds must kill-then-spawn exactly once,
  // and nothing may spawn after close().
  let restarting: Promise<void> = Promise.resolve()

  const spawnElectron = (): void => { /* unchanged */ }

  const restartElectron = (): void => {
    if (closed || !electronStarted)
      return
    restarting = restarting.then(async () => {
      if (closed)
        return
      await killTree(electronProcess)
      if (!closed)
        spawnElectron()
    })
  }

  // ... bundleEntry({ ..., onRebuild: restartElectron }) ... spawnElectron()

  return {
    async close() {
      if (closed)
        return
      closed = true
      await Promise.all([restarting, killTree(electronProcess), watcher?.dispose()])
    },
  }
```

Notes:
- `onRebuild: restartElectron` directly (it is now sync/fire-and-forget-safe);
  drop the `() => void restartElectron()` wrapper.
- The final `killTree` in `close()` is still needed: `restarting` covers an
  in-flight kill, but a never-restarted process must still die.
- Do not change `spawnElectron`, the watcher wiring, or anything outside these
  locals.

**Verify**: `pnpm typecheck` → exit 0; `pnpm build && pnpm exec vitest run test/driver.test.ts` → all pass (behavior for single-restart unchanged).

### Step 2: Pin the race with a test

Create `test/driver-restart.test.ts`. Mock every IO boundary so the test runs
fast and deterministic:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  spawnCalls: 0,
  killCalls: 0,
  disposeCalls: 0,
  onRebuild: undefined as undefined | (() => void),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    state.spawnCalls++
    return { pid: 1234, exitCode: null, signalCode: null, once: vi.fn() }
  }),
}))
vi.mock('../src/orchestrate/electron', () => ({
  killTree: vi.fn(async () => { state.killCalls++ }),
  resolveElectronBinary: vi.fn(() => '/fake/electron'),
}))
vi.mock('../src/orchestrate/app-bundle', () => ({
  prepareDevAppBundle: vi.fn(async (o: { electronBinary: string }) => o.electronBinary),
}))
vi.mock('../src/orchestrate/bundle', () => ({
  bundleEntry: vi.fn(async (o: { onRebuild?: () => void }) => {
    state.onRebuild = o.onRebuild
    return { dispose: vi.fn(async () => { state.disposeCalls++ }) }
  }),
  bundlePreload: vi.fn(async () => {}),
}))
vi.mock('../src/shared/assets', () => ({
  copyAssets: vi.fn(async () => ({ icon: 'icon.png' })),
}))
```

Then a `resolved` fixture: build it via `resolveDesktopConfig` on a temp project
like `test/driver.test.ts` does (`package.json` + `src/manifest.json` via
`createProject`-style helper with the `@uni-helper/desktop` symlink), then
`resolved.root = root`.

Tests:

1. `two overlapping rebuilds spawn exactly once more` — `startDesktopDevRuntime(resolved, 'http://localhost:5173')`;
   `await vi.waitFor(() => expect(state.spawnCalls).toBe(1))` (initial spawn);
   call `state.onRebuild!()` twice synchronously; await a macrotask tick
   (`await new Promise(r => setTimeout(r, 20))`) → `state.spawnCalls === 2`,
   `state.killCalls === 1`.
2. `close prevents respawns and disposes the watcher` — continue from test 1's
   state (or a fresh runtime): call `onRebuild()` then immediately
   `await handle.close()`; after a tick, `state.spawnCalls` unchanged by that
   rebuild, `state.killCalls` grew by the close-kill, `state.disposeCalls === 1`;
   a further `onRebuild()` after close does nothing.
3. `close is idempotent` — second `await handle.close()` does not increment
   kill/dispose counts.

Because each test needs a fresh module state, put the mocks at file top and
create a fresh runtime handle per test (the `state.*` counters reset in
`beforeEach`). `startDesktopDevRuntime` also does `rm(electronDir, ...)` and
`bakeConfig`/`copyAssets` — `copyAssets` is mocked; `bakeConfig` is pure
(config math, needs `resolved` fixture); the `rm`s run against the temp root —
fine.

**Verify**: `pnpm build && pnpm exec vitest run test/driver-restart.test.ts` → all pass.

### Step 3: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

- New file `test/driver-restart.test.ts`, 3 tests (Step 2) — pattern: boundary
  mocks like `test/driver.test.ts`'s `vi.mock('../src/orchestrate/pack')`.
- Existing `test/driver.test.ts` must pass unchanged.

## Done criteria

- [ ] `grep -n "restarting" src/vite/driver.ts` shows the chain
- [ ] `grep -n "closed" src/vite/driver.ts` shows the check inside the restart body
- [ ] New tests pass; `pnpm test` exits 0
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `bundleEntry`'s mocked shape diverges (e.g. it returns a non-disposable) — read
  the live `src/orchestrate/bundle.ts` and adapt the mock, then confirm.
- Timing-based assertions flake twice — increase the tick delays; if still
  flaky, report instead of restructuring the test into fake timers.

## Maintenance notes

- Plan 003/004 touch `src/runtime/index.ts`, not the driver — no conflict.
- Reviewer scrutiny: single-rebuild latency must not regress (the chain adds a
  microtask hop, not a debounce); close() must not hang if a rebuild is
  mid-kill (`restarting` resolves because killTree resolves).
