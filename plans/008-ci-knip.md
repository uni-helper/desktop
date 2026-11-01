# Plan 008: Run knip in CI

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- .github/workflows/ci.yml package.json`
> If those changed, read them live. Plan 007 edits the same workflow file — if it
> landed first, add this job on top of its version.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (coordinates with plan 007 only by file overlap)
- **Category**: dx
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`pnpm knip` is one of the repo's four declared gates (AGENTS.md), but it runs
only locally via `pnpm ci` and the pre-commit hook — neither of which applies to
fork PRs or `SKIP_SIMPLE_GIT_HOOKS=1`. knip is also the guard keeping the
`src/templates/*` knip entries honest. A PR can land unused exports, dead files
or dangling dependencies with green CI. After this plan, knip blocks in CI like
lint and tests do.

## Current state

- `.github/workflows/ci.yml`: one reusable job (`unit-test` via
  `sxzz/workflows/.github/workflows/unit-test.yml@main`) plus (after plan 007)
  an `example-build` job. The reusable workflow's input schema is not verified,
  so this plan adds a dedicated job instead of passing inputs.
- `package.json`: `knip` script exists (`"knip": "knip"`), `knip` is a
  devDependency (catalog `^6.38.0`), config in `knip.json` covering the root
  workspace and `examples/quick-start`.
- Local gate: `pnpm knip` exits 0 on the current tree (verified during the audit).

House rules: minimal workflow; do not enable the commented coverage job; do not
restructure the existing jobs.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Knip locally | `pnpm knip` | exit 0 |
| Lint the workflow change | `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (add one job)

**Out of scope**:
- `knip.json` (already correct), `package.json` scripts, the sxzz reusable
  workflow invocation.

## Git workflow

- Branch: `advisor/008-ci-knip`
- Commit: `ci: 增加 knip 检查任务`

## Steps

### Step 1: Add the knip job

Append to `.github/workflows/ci.yml` (after the `example-build` job if present,
else after `unit-test`):

```yaml
  knip:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm knip
```

(`pnpm/action-setup` with no inputs reads `packageManager` from `package.json`
— keep it inputless, matching plan 007.)

**Verify**: `pnpm knip` → exit 0 locally (the job runs the same command; first
CI push validates the YAML).

### Step 2: Gates

**Verify**: `pnpm lint` → exit 0.

## Test plan

No tests. First CI run is the verification; the local `pnpm knip` gate is the
same command the job runs.

## Done criteria

- [ ] `.github/workflows/ci.yml` contains a `knip` job running `pnpm knip`
- [ ] Local `pnpm knip` exits 0
- [ ] `git status --short` shows only `.github/workflows/ci.yml` and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- Local `pnpm knip` fails (then the tree has an unused-export problem unrelated
  to this plan — report the knip output).

## Maintenance notes

- If the sxzz reusable workflow later grows a verified `test` input that accepts
  appended commands, this job can collapse into it — revisit, don't preempt.
