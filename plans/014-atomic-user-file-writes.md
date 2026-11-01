# Plan 014: Write user files atomically during the startup self-check

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/vite/setup.ts test/setup.test.ts`
> If those changed, read them live.

## Status

- **Priority**: P3 (user-approved defense; probability low, blast radius high)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (data-safety hardening)
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The startup self-check rewrites two files the user owns — `package.json`
(append desktop scripts, `src/vite/setup.ts:79`) and `src/manifest.json`
(normalize h5.router, `src/vite/setup.ts:111`) — with plain in-place
`writeFile`. A crash, SIGKILL or disk-full mid-write leaves a **truncated
package.json or manifest.json**: the whole project stops building, with no
backup, for a fix whose entire content is known before writing. Probability is
low (AGENTS.md's 防过度防御 rule was invoked and the user explicitly approved
this one); the fix is two lines of mechanical pattern (temp file + same-dir
rename), so the trade was accepted. NOTE: plan 020 adds a third user-file write
site (`package.json` uni-app block) — it should reuse this helper (soft
coordination only).

## Current state

`src/vite/setup.ts` — the two write sites:

```ts
// line ~79, inside ensureDesktopScripts:
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

// line ~111, inside ensureManifestRouter:
  await writeFile(manifestPath, `${doc.stringify()}\n`)
```

Both files are read in full immediately before writing, so the complete new
content always exists in memory. The module imports
`{ readFile, writeFile } from 'node:fs/promises'` and `{ join } from 'node:path'`.

Existing test coverage: `test/setup.test.ts` asserts content round-trips
(`#ifdef` survival, scripts added, quiet-on-second-run) — these must pass
unchanged; atomic rename is transparent to them.

House rules: ONE local helper in setup.ts used by both sites (two call sites =
justified; do not export it, do not put it in shared/); no retry logic, no
backup-file feature — the rename is the whole fix.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Setup tests | `pnpm build && pnpm exec vitest run test/setup.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/vite/setup.ts` (helper + two call sites)

**Out of scope**:
- `src/config/resolve.ts` (reads only), `src/shared/manifest.ts` (parse only).
- `unh.config.ts` creation (`ensureUnhConfig`) — file did not exist before, so a
  torn write has nothing to destroy; leave it.
- Any backup/`.bak` mechanism — rejected as scope creep.

## Git workflow

- Branch: `advisor/014-atomic-user-file-writes`
- Commit: `fix: 自检重写用户文件改为临时文件+rename 原子写入`

## Steps

### Step 1: Add the helper

In `src/vite/setup.ts`, above `ensureDesktopScripts`:

```ts
/**
 * User-file writes must be atomic: a torn package.json or manifest.json (crash,
 * disk-full mid-write) breaks the whole project, while a rename over the target
 * is all-or-nothing on the same filesystem.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.uni-desktop-tmp`
  await writeFile(tempPath, content)
  await rename(tempPath, filePath)
}
```

Add `rename` to the existing `node:fs/promises` import.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Switch both call sites

Replace the two `await writeFile(...)` lines with
`await writeFileAtomic(pkgPath, ...)` and `await writeFileAtomic(manifestPath, ...)`.
Keep the surrounding log lines and content expressions byte-identical.

**Verify**: `pnpm build && pnpm exec vitest run test/setup.test.ts` → all pass
(content assertions unchanged proves output equivalence).

### Step 3: Pin the no-truncation property with one test

In `test/setup.test.ts`, add one test to the `ensureDesktopProject` describe:

```ts
  it('leaves no temp files behind after rewriting', async () => {
    const root = await createProject(baseProject({
      'src/manifest.json': JSON.stringify({ name: 'setup-app', h5: { router: { mode: 'history' } } }),
    }))

    await ensureDesktopProject(root, { interactive: false })

    const entries = await readdir(root)
    expect(entries.filter(name => name.includes('uni-desktop-tmp'))).toEqual([])
  })
```

(add `readdir` to the existing `node:fs/promises` import in the test file.)

**Verify**: `pnpm build && pnpm exec vitest run test/setup.test.ts` → all pass.

### Step 4: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

- One new test (Step 3) in the existing setup suite; content equivalence proven
  by the unchanged existing assertions (round-trip, conditional-compilation
  survival, quiet-on-second-run).

## Done criteria

- [ ] `grep -n "writeFileAtomic" src/vite/setup.ts` shows helper + 2 call sites
- [ ] `grep -n "writeFile(pkgPath\|writeFile(manifestPath" src/vite/setup.ts` → no matches
- [ ] `pnpm test` exits 0 with the new test present
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A setup test fails on content — the rename must be transparent; a failure
  means the temp-file suffix leaked into parsed content (report the actual diff).

## Maintenance notes

- Plan 020 introduces a third user-file write (`package.json` uni-app block,
  sync context) — it should use the same pattern via `writeFileSync` + `renameSync`;
  if 020 lands first, migrate its write to this helper's async twin as part of
  that plan.
- Reviewer scrutiny: temp file must live in the SAME directory as the target
  (rename across devices fails) — the helper's `${filePath}.tmp` guarantees it.
