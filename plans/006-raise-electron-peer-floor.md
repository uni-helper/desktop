# Plan 006: Raise the electron peer floor to >=25 and align the esbuild target

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- package.json src/orchestrate/bundle.ts src/runtime/index.ts`
> If those changed, read them live before trusting the excerpts.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: migration (dependency honesty)
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`package.json` declares `"electron": ">=20"`, but the runtime uses
`protocol.handle` (`src/runtime/index.ts:319`) — an API added in Electron 25 —
and global `Request`/`Response` (lines 108–120), which require the Node 18 the
Electron 20–24 line does not embed (they ship Node 16). A user on any allowed
but older Electron gets `protocol.handle is not a function` at app ready and the
window never loads. The floor is dishonest about the oldest supported version;
peers are optional, so nothing else validates it. The esbuild `target: 'node20'`
(`src/orchestrate/bundle.ts:59,85`) is likewise misaligned with a floor whose
embedded Node is 18.

## Current state

- `package.json:63-67`:
  ```json
  "peerDependencies": {
    "electron": ">=20",
    "electron-builder": ">=24",
    "electron-updater": ">=6"
  },
  ```
- `src/runtime/index.ts:319` — `protocol.handle(DESKTOP_FILE_SCHEME, serveDesktopFileRequest)`
  (`protocol.handle` landed in Electron 25; `registerFileProtocol` is the
  deprecated pre-25 alternative).
- `src/runtime/index.ts:108-120` — the handler uses global `Request`/`Response`
  (Node 18+; Electron 25 is the first line embedding Node 18.15).
- `src/orchestrate/bundle.ts:59,85` — `target: 'node20'` in both `bundleEntry`
  and `bundlePreload`.
- Verified honest as-is, no change needed: `electron-updater >=6` (the
  autoUpdater API surface used is 4+-era) and `electron-builder >=24` (all config
  keys used are long-standing).
- The devDependency catalog (`pnpm-workspace.yaml`) pins `electron ^45.0.0` —
  unchanged by this plan.

House rules: this is a metadata + one-constant change; no defensive version
checks at runtime (single-entry validation — the peer range IS the entry check).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `package.json` (peer range)
- `src/orchestrate/bundle.ts` (esbuild target)
- `README.md` (one requirement line)

**Out of scope**:
- `pnpm-workspace.yaml` catalogs (dev versions stay on ^45).
- No runtime version detection, no engine fields for node, no electron-builder /
  electron-updater floor changes.

## Git workflow

- Branch: `advisor/006-electron-peer-floor`
- Commit: `fix: electron  peer 下限提升至 >=25，对齐 protocol.handle 所需版本`

## Steps

### Step 1: Bump the peer range

`package.json`: `"electron": ">=20"` → `"electron": ">=25"`. Touch nothing else
in the block. Run `pnpm install --lockfile-only`? Not needed — peerDependencies
changes don't alter the lockfile resolution for the workspace root, but run
`pnpm install` once anyway to confirm no drift warning.

**Verify**: `grep -A2 '"peerDependencies"' package.json` shows `>=25`; `pnpm install` → exit 0.

### Step 2: Align the esbuild target

`src/orchestrate/bundle.ts`: in `bundleEntry` (line 59) and `bundlePreload`
(line 85), change `target: 'node20'` → `target: 'node18'` (both occurrences; a
comment is unnecessary — the peer range is the documentation).

**Verify**: `pnpm build && pnpm exec vitest run test/bundle.test.ts` → all pass
(the bundle assertions are text-based and target-independent).

### Step 3: README requirement line

In `README.md`, at the end of the 「已有 uni-app 项目」安装依赖 paragraph (after
the `pnpm add -D ...` code block), add one sentence:

> 要求 Electron ≥ 25（运行时用到 `protocol.handle` 与内置 Node 18 的全局 `Request`/`Response`）。

**Verify**: `pnpm lint` → exit 0.

### Step 4: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

No new tests — the change is metadata plus a compile target; the existing bundle
tests pin that output remains electron-external and textually intact.

## Done criteria

- [ ] `grep -n '">=25"' package.json` matches the electron peer
- [ ] `grep -n "node18" src/orchestrate/bundle.ts` matches twice, `node20` zero times
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm knip` all exit 0
- [ ] README contains the requirement sentence
- [ ] `plans/README.md` status row updated

## STOP conditions

- `pnpm install` reports peer conflicts from the example workspace that this
  change causes (the example uses `catalog:` → `^45`, so this should not happen;
  if it does, report the conflict).

## Maintenance notes

- If `protocol.handle` usage is ever replaced with a pre-25-compatible fallback,
  the floor can drop again — but do not add such a fallback speculatively.
- Reviewer scrutiny: confirm nothing else in the runtime assumes newer-than-25
  APIs (a quick `grep -nE "app\.|webContents\." src/runtime/index.ts` skim for
  obviously newer methods; nothing found at plan time).
