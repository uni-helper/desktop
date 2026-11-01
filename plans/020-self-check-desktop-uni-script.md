# Plan 020: Let the self-check create the missing uni-app.scripts.desktop entry

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/vite/setup.ts src/vite/index.ts src/shared/scripts.ts test/setup.test.ts`
> If those changed, read them live. Plan 014 adds `writeFileAtomic` to setup.ts —
> coordinate (see Step 1).

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: MED (writes package.json before the user opted in)
- **Depends on**: none (coordinates with plan 014's atomic write pattern)
- **Category**: direction (first-run UX)
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The self-check auto-fixes everything except the one block without which nothing
runs: a missing `uni-app.scripts.desktop` hard-throws in `configResolved`
(`src/vite/index.ts:147-152`, `UNI_PLATFORM === 'desktop'` means uni could not
resolve the custom platform) with a paste-ready snippet — and the run dies. The
same self-check happily writes npm scripts, manifest router, `unh.config.ts` and
installs dependencies (`src/vite/setup.ts`), and it already owns the exact
correct block (`desktopScriptSnippet()` in `src/shared/scripts.ts`). Creating a
*missing* entry has no conflict with user intent (the user just asked to run
`-p desktop`); only rewriting a *user-maintained* entry does — and that keeps
its current behavior.

Constraint discovered during the audit: in dev, `configResolved` throws BEFORE
`configureServer`/`buildStart` ever run, so the fix must live in (or be called
from) `configResolved` itself — a sync hook. Therefore the write is
synchronous (`writeFileSync` + `renameSync`), and after writing the current run
still cannot proceed (uni already resolved `UNI_PLATFORM: desktop` for this
process) — the error becomes "已自动写入，请重新运行" instead of "请手动粘贴".

## Current state

- `src/vite/index.ts:140-153`:
  ```ts
  configResolved(config) {
    root = config.root
    viteConfig = config
    desktop = isDesktopBuild()
    if (process.env.UNI_PLATFORM === 'desktop') {
      throw new DesktopError(
        `\`uni -p desktop\` needs the \`uni-app.scripts.desktop\` custom platform in package.json:\n\n${desktopScriptSnippet()}`,
      )
    }
  },
  ```
- `src/vite/setup.ts:59-69` — `checkDesktopUniScript(pkg)`: throws when the entry
  is missing (line 62 — a safety net that is currently unreachable in dev
  because the hook above throws first) or when `env.UNI_PLATFORM !== 'h5'`;
  warns when `define` lacks `H5: false`/`WEB: false`. It deliberately does NOT
  rewrite user-maintained entries.
- `src/shared/scripts.ts` — `DESKTOP_SCRIPT_NAME = 'desktop'`,
  `desktopScriptSnippet()` returning the exact JSON block.
- `src/vite/setup.ts` `ensureDesktopScripts` (line 72) — the existing pattern for
  "append to package.json and log success".
- `test/setup.test.ts` — `createProject`/`baseProject` helpers; the
  `rejects a desktop entry whose base platform is not h5` test pins the
  malformed-entry behavior.

House rules: keep the malformed-entry throw untouched; the missing-entry path
writes once, logs, and tells the user to re-run. package.json rewrites drop
comments (already true of `ensureDesktopScripts` — consistent).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Setup tests | `pnpm build && pnpm exec vitest run test/setup.test.ts` | all pass |
| Vite tests | `pnpm build && pnpm exec vitest run test/vite.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/vite/setup.ts` (new sync `ensureDesktopUniScript` helper)
- `src/vite/index.ts` (configResolved calls it instead of plain-throwing)
- `test/setup.test.ts` (new cases)
- `README.md` (使用 section — the manual wiring step becomes optional)

**Out of scope**:
- `checkDesktopUniScript`'s malformed-entry throws (`env`/`define` problems)
  stay exactly as they are.
- No interactive confirm here — `configResolved` is sync; the write is small,
  idempotent and required for the run the user just requested. Record this
  decision in the code comment.
- `desktopScriptSnippet` unchanged.

## Git workflow

- Branch: `advisor/020-self-check-desktop-uni-script`
- Commit: `feat: 启动自检自动补齐缺失的 uni-app.scripts.desktop 平台声明`

## Steps

### Step 1: The sync writer in setup.ts

In `src/vite/setup.ts` add (if plan 014 landed, mirror its atomic pattern with
the sync variants; otherwise use plain writeFileSync + renameSync inline):

```ts
/**
 * Create the missing `uni-app.scripts.desktop` custom platform entry so the
 * first `uni -p desktop` does not dead-end on a hand-pasted JSON block. Called
 * from the sync `configResolved` hook, hence the sync fs calls. A
 * user-maintained entry is never rewritten here — wrong `env`/`define` keep
 * their explicit errors from `checkDesktopUniScript`.
 */
export function ensureDesktopUniScript(root: string): void {
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as ProjectPackage
  if (pkg['uni-app']?.scripts?.[DESKTOP_SCRIPT_NAME])
    return
  pkg['uni-app'] ??= {}
  pkg['uni-app'].scripts ??= {}
  pkg['uni-app'].scripts[DESKTOP_SCRIPT_NAME] = DESKTOP_UNI_SCRIPT
  const tempPath = `${pkgPath}.uni-desktop-tmp`
  writeFileSync(tempPath, `${JSON.stringify(pkg, null, 2)}\n`)
  renameSync(tempPath, pkgPath)
  logger.success('added uni-app.scripts.desktop to package.json; re-run the command to apply it')
}
```

This requires exporting `DESKTOP_UNI_SCRIPT` from `src/shared/scripts.ts`
(today only `desktopScriptSnippet()` is exported and the script object is a
private const — export the const, keep `desktopScriptSnippet` building from it).
Extend the fs imports with the sync variants
(`readFileSync, writeFileSync, renameSync` from `node:fs`) — setup.ts currently
imports only async fs. Note `ProjectPackage`'s `'uni-app'` type: its `scripts`
value type is `Record<string, { env?, define? }>` — the written object matches.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Call it from configResolved

`src/vite/index.ts:147-152` becomes:

```ts
      if (process.env.UNI_PLATFORM === 'desktop') {
        // uni could not resolve the custom platform: create the missing entry
        // (the one wiring the self-check refuses to leave missing) and ask for
        // a re-run, since this process already resolved UNI_PLATFORM wrong.
        ensureDesktopUniScript(root)
        throw new DesktopError(
          `\`uni -p desktop\` needs the \`uni-app.scripts.desktop\` custom platform, which was just added to package.json.\nRe-run the command to apply it.`,
        )
      }
```

(keep `desktopScriptSnippet` imported if still referenced elsewhere — check
`src/vite/index.ts` imports; if now unused, remove the import and let knip
confirm.)

**Verify**: `pnpm build && pnpm exec vitest run test/vite.test.ts` → all pass
(the plugin tests construct configs without `UNI_PLATFORM=desktop`, so the
branch stays unexercised there).

### Step 3: Tests

In `test/setup.test.ts`:

1. `creates the missing desktop uni script entry` — `createProject({ 'package.json': JSON.stringify({ name: 'setup-test', scripts: {} }) })`
   (no uni-app key at all) → call the exported `ensureDesktopUniScript(root)` →
   re-read package.json: `pkg['uni-app'].scripts.desktop` matches
   `{ title: 'Desktop', env: { UNI_PLATFORM: 'h5' }, define: { DESKTOP: true, H5: false, WEB: false } }`;
   no `.uni-desktop-tmp` file remains.
2. `leaves an existing entry untouched` — `baseProject()` already has the entry
   (with its exact shape) → call → `readFile` bytes identical to before.
3. Integrate with `ensureDesktopProject`: a temp project whose package.json
   lacks the entry, with `UNI_PLATFORM` NOT set — `ensureDesktopProject` still
   rejects (its `checkDesktopUniScript` guard) — pin that the guard still
   throws for direct calls (unchanged behavior).

**Verify**: `pnpm build && pnpm exec vitest run test/setup.test.ts` → all pass.

### Step 4: README

In `## 使用 > 已有 uni-app 项目`, the paragraph introducing the two wirings
(「做两处接线。其一，…」) — adjust to say the entry is created automatically when
missing (the run ends asking to re-run), while keeping the JSON block for
reference/manual setup. One added sentence:
「该声明缺失时，首次运行会自动写入 package.json 并提示重新运行；也可手动粘贴。」
Also update the 自检 bullet in 特性 if it enumerates what the self-check fixes
(it lists manifest/垫片导入/unh.config/scripts — add 平台声明).

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

Three new setup tests (Step 3); `test/vite.test.ts` proves the plugin still
loads. No snapshot changes (no exported TYPE changed — `ensureDesktopUniScript`
is a new exported function: tsnapi may flag the new export; run
`TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u` if
it does).

## Done criteria

- [ ] `grep -n "ensureDesktopUniScript" src/vite/setup.ts src/vite/index.ts` matches both
- [ ] `pnpm test` exits 0 with the new tests (snapshots regenerated if flagged)
- [ ] README updated in both places
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `configResolved` turns out to be called in contexts where `root`'s
  package.json is not writable or where writing would surprise (e.g. tests
  constructing virtual configs) — report the observed context.
- The uni resolution behavior changed such that `UNI_PLATFORM === 'desktop'` no
  longer indicates a missing entry.

## Maintenance notes

- If uni ever supports declaring custom platforms outside package.json, this
  writer is the thing to replace.
- Reviewer scrutiny: the write is idempotent (missing-check first), atomic
  (temp+rename), and never touches an existing entry — even a wrong one.
