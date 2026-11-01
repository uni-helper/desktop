# Plan 009: Single-source the assembled-app layout contract

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/shared/paths.ts src/vite/driver.ts src/orchestrate/pack.ts src/orchestrate/bundle.ts src/runtime/index.ts`
> If those changed, read them live before trusting the excerpts.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The assembled app's directory layout (`electron/`, `web/`, `resources/`,
`main.cjs`, `preload.cjs`, `package.json`) is independently encoded in four
files, and drift has already started: `src/shared/paths.ts:12` exports
`APP_RESOURCES_DIR = 'resources'`, but `src/vite/driver.ts:56` re-hardcodes the
`'resources'` literal. Renaming any part of the layout requires editing all four
sites in lockstep; a miss produces an app that assembles and packs successfully
but fails only at packaged-app runtime — the most expensive place to discover
it. This is an in-lockstep 4-site coupling, exactly the case the repo's
「拒绝提前抽象」rule carves out for constants-as-contracts: the constants already
exist, they just aren't used everywhere.

## Current state

The four independent encodings:

1. `src/vite/driver.ts` — dev/build assembly:
   - line 56: `await rm(join(outDir, 'resources'), { recursive: true, force: true })` ← the drift
   - lines 48–49: `join(outDir, 'electron')` via `electronDir`
   - line 76: `spawn(launchBinary, [join(electronDir, 'main.cjs')], ...)`
   - lines 154–163: app `package.json` with `main: 'electron/main.cjs'`
2. `src/runtime/index.ts` — the packaged consumer:
   - line 42: `assetsRoot() = join(__dirname, '..', 'resources')`
   - line 223: `preload: join(__dirname, 'preload.cjs')`
   - line 234: `loadFile(join(__dirname, '../web/index.html'))`
3. `src/orchestrate/pack.ts` — electron-builder globs:
   - line 64: `files: ['electron/**/*', 'web/**/*', 'resources/**/*', 'package.json']`
   - lines 51, 62: `${APP_RESOURCES_DIR}/${appIconFileName(...)}`, `buildResources: APP_RESOURCES_DIR`
4. `src/orchestrate/bundle.ts` — output filenames:
   - line 60: `outfile: join(options.outDir, 'main.cjs')`
   - line 86: `outfile: join(options.outDir, 'preload.cjs')`

`src/shared/paths.ts` today (relevant part):

```ts
/** Directory (relative to the project root) receiving the assembled app from a build. */
export const BUILD_APP_DIR = 'dist/build/desktop'

/** Directory (relative to the project root) holding the dev shell runtime. */
export const DEV_APP_DIR = 'dist/dev/desktop'

/** Directory (relative to the app dir) holding assets referenced by the baked config. */
export const APP_RESOURCES_DIR = 'resources'
```

Existing consumers of `src/shared/paths.ts`: `src/vite/driver.ts:16` (BUILD/DEV
APP_DIR), `src/orchestrate/pack.ts:9` + `src/shared/assets.ts:4` (APP_RESOURCES_DIR),
`src/orchestrate/app-bundle.ts:9` (DEV_APP_DIR). Tests that pin the layout:
`test/driver.test.ts` (asserts `electron/main.cjs`, `web/index.html`,
`resources/icon.png`, `package.json` shape) and `test/bundle.test.ts`
(`main.cjs`, `preload.cjs`).

House rules: constants + one documenting comment block; no new helper functions;
the runtime imports the constants (it already imports from `../shared/protocol`,
so `../shared/paths` is consistent bundling-wise — `shared/paths.ts` uses only
node builtins).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/shared/paths.ts` (new constants + contract comment)
- `src/vite/driver.ts` (use constants)
- `src/orchestrate/pack.ts` (globs from constants)
- `src/orchestrate/bundle.ts` (outfile names from constants)
- `src/runtime/index.ts` (assetsRoot / preload / web index from constants)

**Out of scope**:
- `test/driver.test.ts` / `test/bundle.test.ts` — they already pin the layout
  with literal strings and SHOULD stay literal (a test that imports the
  constants it asserts would never catch a constant change).
- `src/orchestrate/app-bundle.ts` (uses DEV_APP_DIR already), `src/shared/templates.ts`.
- No behavior change of any kind — pure constant consolidation.

## Git workflow

- Branch: `advisor/009-layout-contract`
- Commit: `refactor: 组装目录布局契约收敛到 shared/paths，消除四处分散的字面量`

## Steps

### Step 1: Declare the contract in shared/paths.ts

Extend `src/shared/paths.ts`:

```ts
/**
 * The assembled app layout contract, shared by the build side (driver, pack,
 * bundle) and the runtime side (createDesktopApp). Renaming any of these means
 * editing every consumer in the same commit — `test/driver.test.ts` and
 * `test/bundle.test.ts` pin the literals and will catch a miss.
 *
 * appDir/
 *   package.json        ← written by `assembleDesktopApp` (main: electron/main.cjs)
 *   electron/main.cjs   ← esbuild bundle of the main-process entry
 *   electron/preload.cjs ← esbuild bundle of the preload template
 *   web/                ← the uni h5 build output, moved in wholesale
 *   resources/          ← icons referenced by the baked config
 */
/** Directory (relative to the app dir) holding the bundled main/preload scripts. */
export const APP_ELECTRON_DIR = 'electron'
/** Directory (relative to the app dir) holding the uni web build. */
export const APP_WEB_DIR = 'web'
/** File name of the bundled main-process script inside `APP_ELECTRON_DIR`. */
export const MAIN_BUNDLE_FILE = 'main.cjs'
/** File name of the bundled preload script inside `APP_ELECTRON_DIR`. */
export const PRELOAD_BUNDLE_FILE = 'preload.cjs'
```

(`APP_RESOURCES_DIR` and its comment already exist — leave them.)

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Consume the constants on the build side

- `src/vite/driver.ts`:
  - line 56 → `await rm(join(outDir, APP_RESOURCES_DIR), { recursive: true, force: true })`
  - line 49 `electronDir` stays a `join(outDir, APP_ELECTRON_DIR)` variable
  - line 76 spawn arg → `join(electronDir, MAIN_BUNDLE_FILE)`
  - lines 154–163 `main:` → `join(APP_ELECTRON_DIR, MAIN_BUNDLE_FILE)`
  - extend the existing import from `'../shared/paths'` (line 16) with the new names.
- `src/orchestrate/pack.ts` line 64:
  `files: [`${APP_ELECTRON_DIR}/**/*`, `${APP_WEB_DIR}/**/*`, `${APP_RESOURCES_DIR}/**/*`, 'package.json']`
  — extend the import at line 9.
- `src/orchestrate/bundle.ts` lines 60/86:
  `outfile: join(options.outDir, MAIN_BUNDLE_FILE)` /
  `join(options.outDir, PRELOAD_BUNDLE_FILE)` — add the import
  (`import { MAIN_BUNDLE_FILE, PRELOAD_BUNDLE_FILE } from '../shared/paths'`).

**Verify**: `pnpm build && pnpm exec vitest run test/driver.test.ts test/bundle.test.ts` → all pass (the literal-string pins prove the constants resolve to the same values).

### Step 3: Consume the constants on the runtime side

`src/runtime/index.ts`:

- line 42 `assetsRoot()` → `join(__dirname, '..', APP_RESOURCES_DIR)`
- line 223 → `join(__dirname, PRELOAD_BUNDLE_FILE)`
- line 234 → `loadFile(join(__dirname, '..', APP_WEB_DIR, 'index.html'))`
  (the `index.html` literal stays — it is uni's contract, not ours)
- extend the existing `import { DESKTOP_FILE_SCHEME, ... } from '../shared/protocol'`
  area with `import { APP_RESOURCES_DIR, APP_WEB_DIR, PRELOAD_BUNDLE_FILE } from '../shared/paths'`.

Check the runtime does not gain any NEW import weight: `shared/paths.ts` already
ends up in `main.cjs` transitively (via config/resolve through the baked define
path? — verify with `grep -c "APP_RESOURCES_DIR" dist/runtime/index.mjs` after
build; if `shared/paths.ts` was not previously bundled into the runtime, this is
still fine — it is tiny and dependency-free).

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts test/driver.test.ts` → all pass.

### Step 4: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

No new tests — the existing `test/driver.test.ts` / `test/bundle.test.ts`
literal pins ARE the verification that the consolidation is behavior-preserving.

## Done criteria

- [ ] `grep -rn "'resources'" src/` → no matches (constant references only)
- [ ] `grep -rn "main.cjs\|preload.cjs" src/` → only `shared/paths.ts` declarations
      (and no other literals)
- [ ] `pnpm test` exits 0 unchanged
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A grep in Done criteria reveals a literal that is NOT one of the four contract
  sites (e.g. electron-builder's `buildResources`) — handle only the listed
  files; report the others.

## Maintenance notes

- The contract comment in `paths.ts` is the review anchor for any future layout
  change; update it in the same commit as the constants.
- Reviewer scrutiny: `test/driver.test.ts` literals unchanged (they must keep
  pinning the real values).
