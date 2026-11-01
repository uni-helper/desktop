# Plan 010: Trim build-side-only fields from BakedDesktopConfig

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/baked.ts src/config/resolve.ts src/runtime/index.ts test/bundle.test.ts test/config.test.ts test/__snapshots__/`
> If those changed, read them live. Plans 005/002 may have touched
> `src/runtime/index.ts` — read it live regardless.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (breaks a public type → snapshot regen included here)
- **Category**: tech-debt
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`BakedDesktopConfig` is a public, exported type (from `.` and `./main`) that is
esbuild-defined into the bundled main process — it is the contract a custom-main
author sees. It declares `appId` and `version` (and carries the full
`DesktopUpdaterConfig` incl. `provider`/`url`), but `createDesktopApp` never
reads any of them: the real consumers of `appId`/`version` are the build side
(`src/vite/driver.ts:154-163` app package.json, `src/orchestrate/pack.ts:54`), and
electron-updater reads its feed from the builder-generated `app-update.yml`, not
the baked config. The dead payload ships in every `main.cjs` and the misleading
public type suggests the runtime consumes appId/version. The project is
unreleased — removing them is a free breaking change (AGENTS.md).

## Current state

`src/baked.ts` (whole type):

```ts
export interface BakedDesktopConfig {
  appName: string
  appId: string
  version: string
  window: ResolvedWindowConfig
  dev: { openDevtools: boolean }
  tray: { icon?: string, tooltip?: string, menu?: DesktopTrayMenuItem[] } | false
  updater: DesktopUpdaterConfig | false
  /** File name of the window icon inside the app resources directory */
  icon?: string
}
```

`src/config/resolve.ts:243-264` — `bakeConfig` populates `appId`,
`version`, and passes `resolved.updater` through untouched.

`src/runtime/index.ts` — verified zero reads of `baked.appId` / `baked.version`;
the only `updater` fields read are `autoDownload` / `autoInstallOnAppQuit`
(lines 274–277). `grep -rn "baked.appId\|baked.version\|\.provider\|\.url" src/runtime/index.ts src/templates/main.ts`
returns nothing relevant.

Public-API snapshot mechanics (AGENTS.md): type changes require regenerating
`test/__snapshots__/tsnapi/**` with `TSNAPI_ALLOW_BREAKING=1` and `-u` in the
same change, plus a README update if the public surface is documented there.

House rules: this is a deletion, not a refactor — no replacement type is added
unless the runtime needs it (it needs `{ autoDownload?, autoInstallOnAppQuit? }`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| All tests | `pnpm test` | exit 0 (will FAIL until fixtures/snapshots updated — expected) |
| Snapshot regen | `pnpm build && TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u` | snapshots updated |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/baked.ts` (drop `appId`/`version`; narrow `updater`)
- `src/config/resolve.ts` (`bakeConfig` stops emitting them)
- `test/bundle.test.ts` (`baked` fixture drops the fields)
- `test/config.test.ts` (any `bakeConfig` assertions — read the file first; only
  fix assertions that reference the removed fields)
- `test/__snapshots__/tsnapi/**` (regenerate)
- `README.md` (only if it documents the baked shape — grep first)

**Out of scope**:
- `src/runtime/index.ts` — zero changes (it never read the fields). If you find
  yourself wanting to touch it, re-read the STOP conditions.
- `src/vite/driver.ts` / `src/orchestrate/pack.ts` — they read `resolved.*`,
  not `baked.*`.
- `ResolvedConfig` — unchanged; it remains the single carrier of build-side values.

## Git workflow

- Branch: `advisor/010-baked-config-trim`
- Commit: `refactor: 裁剪 BakedDesktopConfig 中运行时未消费的 appId/version/provider/url 字段`

## Steps

### Step 1: Narrow the type

`src/baked.ts`:

- Delete the `appId: string` and `version: string` lines and the
  `DesktopUpdaterConfig` import if it becomes unused (it does — see below).
- Replace `updater: DesktopUpdaterConfig | false` with:

```ts
  /** The only updater fields the runtime consumes; the feed comes from app-update.yml */
  updater: {
    autoDownload?: boolean
    autoInstallOnAppQuit?: boolean
  } | false
```

Adjust imports: `DesktopTrayMenuItem` and `ResolvedWindowConfig` stay;
`DesktopUpdaterConfig` is no longer imported.

**Verify**: `pnpm typecheck` → FAILS in `src/config/resolve.ts` and test
fixtures — that is the expected signal of Step 2's work.

### Step 2: Update bakeConfig

`src/config/resolve.ts` `bakeConfig`: remove `appId: resolved.appId,` and
`version: resolved.version,`; replace `updater: resolved.updater,` with:

```ts
    updater: resolved.updater
      ? {
          autoDownload: resolved.updater.autoDownload,
          autoInstallOnAppQuit: resolved.updater.autoInstallOnAppQuit,
        }
      : false,
```

**Verify**: `pnpm typecheck` → now fails only in tests (bundle fixture).

### Step 3: Update the test fixture and regenerate snapshots

- `test/bundle.test.ts` `baked` fixture (lines ~15–35): remove `appId:` and
  `version:` lines; `updater: false` stays.
- `test/config.test.ts`: read the whole file; if any test asserts
  `bakeConfig(...)` output fields `appId`/`version`/`updater.provider`, update
  those assertions to the new shape (do not delete the tests).
- Regenerate the public-API snapshots:
  `pnpm build && TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u`
  → `git status` shows the `test/__snapshots__/tsnapi/**` diffs (expect
  `index.snapshot.d.ts`, `main.snapshot.d.ts` — the type shrank).

**Verify**: `pnpm build && pnpm test` → all pass.

### Step 4: README check and gates

`grep -n "BakedDesktopConfig" README.md` — the 自定义主进程 example uses the
type but does not enumerate fields; if any README text lists appId/version as
baked fields, fix it; otherwise leave README untouched.

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint && pnpm build` → all exit 0.

## Test plan

No new tests — deletions covered by existing suites + regenerated snapshots.
The bundle test's `baked` fixture doubles as the compile-time check that the
type actually shrank.

## Done criteria

- [ ] `grep -n "appId\|version" src/baked.ts` → no matches
- [ ] `grep -rn "baked.appId\|baked\.version" src/` → no matches (was already none)
- [ ] `pnpm test` exits 0 with regenerated snapshots committed
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm knip` exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- `src/runtime/index.ts` or `src/templates/main.ts` turns out to read
  `appId`/`version`/`updater.provider` after all (contradicts the audit — report).
- The snapshot regen produces diffs beyond the `BakedDesktopConfig` shape
  (e.g. unrelated exports changed — someone else landed mid-flight; report).

## Maintenance notes

- If the runtime ever needs the feed URL (e.g. a manual update check), add it
  back deliberately — the runtime owns what it consumes.
- Reviewer scrutiny: `bakeConfig` keeps `autoDownload`/`autoInstallOnAppQuit`
  pass-through (the runtime's only updater reads); `ResolvedConfig` untouched.
