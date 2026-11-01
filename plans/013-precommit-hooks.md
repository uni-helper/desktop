# Plan 013: Split the git hooks — fast pre-commit, full gate on pre-push

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- package.json .githooks/ CONTRIBUTING.md`
> If those changed, read them live.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The pre-commit hook runs `pnpm i --frozen-lockfile --ignore-scripts --offline && pnpm run ci && pnpx nano-staged`:
the full CI gate (lint + typecheck + knip + tsdown build + the whole test suite,
including the ~30 s darwin-only PlistBuddy/sips tests) on **every commit** — a
minutes-long loop that discourages small commits. Worse, `pnpx` is `pnpm dlx`:
it fetches the latest nano-staged from the registry on every commit even though
`nano-staged ^1.0.2` is a pinned devDependency — making the hook
network-dependent despite the first step insisting on `--offline`, with an
unpinned supply-chain surface. After this plan: pre-commit stays seconds-fast
(staged-file lint), the full gate moves to pre-push, and nano-staged runs from
the local install.

## Current state

- `package.json:110-115`:
  ```json
  "simple-git-hooks": {
    "pre-commit": "pnpm i --frozen-lockfile --ignore-scripts --offline && pnpm run ci && pnpx nano-staged"
  },
  ```
- `.githooks/pre-commit` (checked in; `core.hooksPath` points here via the
  `prepare` script) — same command plus the SKIP header. simple-git-hooks
  REGENERATES these files on `prepare`, so the source of truth is `package.json`;
  the `.githooks/` copy must be refreshed by running `pnpm run prepare` after
  editing.
- `CONTRIBUTING.md` (6 lines) — mentions Conventional Commits, the full gate
  command, and the eslint config. No mention of hook skipping.
- AGENTS.md declares the full gate (`pnpm lint && pnpm knip && pnpm test &&
  pnpm typecheck && pnpm build`) as a PR requirement — it stays the PR/CI
  requirement; only its *timing* moves to pre-push.

House rules: this is config-only; no script files, no new dependencies.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Regenerate hooks | `pnpm run prepare` | exit 0, `.githooks/pre-push` created |
| Simulate pre-commit | stage a trivial change, `git commit --dry-run` or actually commit on the plan branch | seconds, lint-only |
| Simulate pre-push | `git push --dry-run` (hook runs if remote exists) | full ci runs |

## Scope

**In scope**:
- `package.json` (`simple-git-hooks` block)
- `.githooks/` (regenerated via `pnpm run prepare`)
- `CONTRIBUTING.md` (hook documentation)

**Out of scope**:
- CI workflows (plan 007/008 own those).
- The `prepare` script itself (hooks path + skills sync stay).

## Git workflow

- Branch: `advisor/013-precommit-hooks`
- Commit: `chore: 拆分 git hooks，pre-commit 只做暂存文件 lint，全量门禁移至 pre-push`

## Steps

### Step 1: Edit the hook config

`package.json`:

```json
  "simple-git-hooks": {
    "pre-commit": "pnpm exec nano-staged",
    "pre-push": "pnpm run ci"
  },
```

The `nano-staged` block below it is unchanged. Dropping the `pnpm i` step is
deliberate: committing with uninstalled deps is already broken for any other
step, and the frozen-lockfile reinstall duplicated what CI does.

**Verify**: `pnpm run prepare` → exit 0; `ls .githooks` → contains `pre-commit`
(regenerated, single command) and `pre-push`.

### Step 2: Verify hook behavior locally

On the plan branch, stage a trivial whitespace change in a tracked file and
commit:

**Verify**: commit completes in seconds (no `pnpm run ci` output); `.githooks/pre-commit`
content is just the nano-staged invocation (plus the skip header simple-git-hooks
writes). Then run `pnpm run ci` manually once to prove the gate still works:

**Verify**: `pnpm run ci` → exit 0 (it is now the pre-push command; CI still
runs it independently too).

### Step 3: Document in CONTRIBUTING.md

Append to `CONTRIBUTING.md`:

```markdown
- pre-commit 只对暂存文件跑 eslint（秒级）；完整门禁 `pnpm run ci` 在 pre-push
  执行，CI 上同样执行。跳过本地 hooks：`git commit/push` 时设置
  `SKIP_SIMPLE_GIT_HOOKS=1`（CI 不受影响，仍会跑全量门禁）。
```

**Verify**: `pnpm lint` → exit 0 (markdown is linted).

### Step 4: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

No unit tests (config-only). Step 2 is the behavioral verification.

## Done criteria

- [ ] `grep -n "pnpx" package.json .githooks/pre-commit` → no matches
- [ ] `grep -n "pre-push" package.json` matches; `.githooks/pre-push` exists
- [ ] CONTRIBUTING.md documents the split and the skip variable
- [ ] `pnpm run ci` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- `pnpm run prepare` fails or does not regenerate `.githooks/*` (the
  `simple-git-hooks` version may behave differently than assumed — report).

## Maintenance notes

- If commit-time lint proves too slow on big staged sets, nano-staged's
  concurrency handles it; do not move back to full-ci-on-commit.
- Reviewer scrutiny: the pre-push gate must be identical to CI's command set
  (`pnpm run ci`), so local pre-push failures predict CI failures.
