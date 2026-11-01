# Plan 001: Fix the packaged auto-updater — bundle electron-updater into main.cjs

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/orchestrate/bundle.ts src/runtime/index.ts src/orchestrate/pack.ts src/vite/driver.ts test/bundle.test.ts`
> If any of those files changed since the plan was written, compare the "Current
> state" excerpts against the live code; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The README advertises 自动更新 (electron-updater based) as a working feature, but it
can never work in a packaged app. The main process is esbuild-bundled with
`electron-updater` marked external, so the packaged `main.cjs` does a runtime
`require('electron-updater')` — yet the assembled app directory contains no
`node_modules` at all (its `package.json` declares no dependencies and the
electron-builder `files` globs list only `electron/`, `web/`, `resources/`,
`package.json`). The dynamic import throws `MODULE_NOT_FOUND`, which the runtime
swallows into a single `logger.warn` line. Dev mode works because the require
resolves up to the project's `node_modules` — which is exactly why this went
unnoticed. After this plan, the packaged app actually carries the updater code.

## Current state

- `src/orchestrate/bundle.ts` — esbuild bundling of the electron main process.
  Line 7: `const ELECTRON_EXTERNALS = ['electron', 'electron-updater']`; used at
  line 61 as `external: ELECTRON_EXTERNALS` in `bundleEntry`.
- `src/runtime/index.ts:273` — `const { autoUpdater } = await import('electron-updater')`
  inside `setupUpdater`; lines 283–285 catch any failure into
  `logger.warn('auto update unavailable:', ...)`.
- `src/vite/driver.ts:154-163` — the assembled app's `package.json` is written with
  `name/productName/version/private/main/description/author/homepage` — **no
  `dependencies` field**.
- `src/orchestrate/pack.ts:64` — electron-builder files:
  `files: ['electron/**/*', 'web/**/*', 'resources/**/*', 'package.json']`. No
  node_modules is ever packed.
- Dev spawns the same `main.cjs` but with `cwd` = project root
  (`src/vite/driver.ts:76-83`), so `require('electron-updater')` walks up into the
  project's `node_modules` where electron-updater is a devDependency — hence dev
  works, packaged does not.

Repo conventions to honor:

- Code comments are English; commit messages are Conventional Commits with a
  Chinese subject (see `git log --oneline`, e.g. `fix: 修复桌面端构建的关键逻辑问题，移除冗余代码`).
- House rules from AGENTS.md: no speculative abstraction, no defensive code
  without a concrete failure mode, minimal try/catch.
- Verification gates (AGENTS.md): `pnpm lint && pnpm knip && pnpm test && pnpm typecheck && pnpm build`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `pnpm build` | exit 0 |
| All tests | `pnpm test` | exit 0 (builds first, then vitest) |
| Single test file | `pnpm build && pnpm exec vitest run test/bundle.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `src/orchestrate/bundle.ts`
- `test/bundle.test.ts`
- `README.md` (one sentence, see Step 3)

**Out of scope** (do NOT touch):
- `src/runtime/index.ts` — its dynamic import stays; only the bundling changes.
- `src/orchestrate/pack.ts` / `src/vite/driver.ts` — the "copy the package tree
  into the assembled dir" alternative was considered and rejected; bundling is
  the standard practice and far simpler.
- `ELECTRON_EXTERNALS` must still contain `'electron'` — electron must never be
  bundled.

## Git workflow

- Branch: `advisor/001-fix-packaged-updater`
- Commit style: Conventional Commits, Chinese subject, e.g.
  `fix: 将 electron-updater 打入主进程 bundle，修复打包后自动更新不可用`

## Steps

### Step 1: Remove `electron-updater` from the esbuild externals

In `src/orchestrate/bundle.ts` line 7, change:

```ts
const ELECTRON_EXTERNALS = ['electron', 'electron-updater']
```

to:

```ts
// `electron` must stay a runtime require; electron-updater is bundled so the
// packaged app (which ships no node_modules) can still auto-update.
const ELECTRON_EXTERNALS = ['electron']
```

Keep the name `ELECTRON_EXTERNALS` and its single use site at `external: ELECTRON_EXTERNALS`.
`bundlePreload` already has its own `external: ['electron']` — leave it alone.

The esbuild bundle resolves `electron-updater` from this repo's own devDependencies
(it is listed in `package.json` devDependencies), so the build works without any
user-side install.

**Verify**: `pnpm build` → exit 0, and
`grep -c "electron-updater" dist/runtime/index.mjs` reports a match count > 0
(the updater code is now inlined into the bundle).

### Step 2: Pin the behavior in the bundle test

In `test/bundle.test.ts`, the existing test `keeps electron external` (line ~62)
asserts `output` contains `require("electron")`. Add a sibling assertion test
right after it:

```ts
it('bundles electron-updater so a packaged app can auto-update', async () => {
  await bundleEntry({
    entryPath: join(templateDir, 'main.ts'),
    outDir,
    baked,
    alias: { '@uni-helper/desktop/shim': shimSource, '@uni-helper/desktop/shim/channels': shimChannelsSource },
  })

  const output = await readFile(join(outDir, 'main.cjs'), 'utf8')
  // Externalized, the packaged app (no node_modules in the asar) could not
  // resolve electron-updater and auto update silently died.
  expect(output).not.toContain('require("electron-updater")')
  expect(output).toContain('autoUpdater')
})
```

Note: `test/bundle.test.ts` runs a real esbuild bundle of `src/templates/main.ts`
which transitively imports `src/runtime/index.ts`, so the dynamic
`import('electron-updater')` gets inlined by esbuild (literal specifier) — the
`not.toContain('require("electron-updater")')` assertion is the load-bearing one.
If the `autoUpdater` literal is absent from the generated output (esbuild
transforms the import), inspect `main.cjs` and pick a stable substring you can
actually see; do not weaken the `not.toContain` assertion.

**Verify**: `pnpm build && pnpm exec vitest run test/bundle.test.ts` → all tests pass, including the new one.

### Step 3: One sentence in the README

In `README.md`, section `## 自动更新`, append one sentence at the end of the
section's first paragraph:

> electron-updater 会随主进程一起打包进应用，打包产物不需要携带 node_modules。

**Verify**: `pnpm lint` → exit 0 (README is linted by the antfu config).

### Step 4: Full gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint && pnpm build` → all exit 0.

## Test plan

- New test in `test/bundle.test.ts` (Step 2): updater bundled, electron still
  external. Pattern: copy the structure of the existing `keeps electron external` test.
- No other test changes. `pnpm test` must pass unchanged elsewhere.

## Done criteria

- [ ] `grep -n "ELECTRON_EXTERNALS = " src/orchestrate/bundle.ts` shows `['electron']`
- [ ] `pnpm test` exits 0 with the new assertion test present and passing
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm knip` exit 0
- [ ] README 自动更新 section contains the new sentence
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- esbuild fails to bundle `electron-updater` (e.g. unresolvable dynamic requires
  inside it) — do not switch to the copy-node_modules approach on your own.
- The `test/bundle.test.ts` fixture no longer matches "Current state" (e.g. the
  `baked` fixture shape changed — plan 010 removes `appId`/`version` from it).
- The full gate `pnpm test` fails in a file you did not touch.

## Maintenance notes

- If a future plan adds more runtime npm dependencies (beyond electron), decide
  for each: bundle it (like electron-updater now) or ship it in the assembled
  `package.json` + files globs. Never re-externalize electron-updater.
- Reviewers should scrutinize: the `ELECTRON_EXTERNALS` comment, and that the
  dev spawn path (`startDesktopDevRuntime`) still works — dev now also uses the
  bundled copy, which is fine.
- Bundled `electron-updater` still reads `app-update.yml` from the packaged app
  at runtime — that file is generated by electron-builder from the `publish`
  config, unchanged by this plan.
