# Plan 007: CI-check the real uni pipeline through the quick-start example

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- .github/workflows/ examples/quick-start/`
> If the workflow or the example changed, read them live before trusting the
> excerpts.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The feature this repo exists for — `uni build -p desktop` produces a working
assembled app — is verified only by the maintainer running the example by hand.
CI (`.github/workflows/ci.yml`) runs just the root unit-test workflow. The
riskiest design assumption — that the plugin's `order: 'pre'` `resolveId` beats
uni's own pre-group resolver for `@dcloudio/uni-h5` (`src/vite/index.ts:117-131`)
— is pinned only by a structural assertion (`expect(...resolveId).toMatchObject({
order: 'pre' })` in `test/vite.test.ts:118`), never by a real build. A uni or
vite upgrade that changes resolver ordering, or an assembly regression, lands
green in CI. After this plan, every push runs a real `uni build -p desktop`
(assembly only, no electron-builder) and asserts the artifacts.

## Current state

`.github/workflows/ci.yml` (whole file):

```yaml
name: Unit Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  unit-test:
    uses: sxzz/workflows/.github/workflows/unit-test.yml@main

  # coverage:
  #   uses: sxzz/workflows/.github/workflows/coverage.yml@main
  #   needs: unit-test
  #   permissions:
  #     id-token: write
```

`examples/quick-start/package.json` — name
`@uni-helper/desktop-example-quick-start`; scripts: `build:desktop` =
`uni build -p desktop`; devDeps include `"@uni-helper/desktop": "workspace:*"`,
uni `3.0.0-5030320261023001` snapshot, `vite 5.2.8`, `electron` via `catalog:`.
`examples/quick-start/unh.config.ts` exists with no `pack` key →
`pack.autoPack` defaults to **true** (see `src/config/resolve.ts:159`), which
would run electron-builder — too heavy for CI. The example's `dist/` is local
only (untracked).

Key facts for the job:

- The repo is a pnpm workspace (`pnpm-workspace.yaml`, `packages: [examples/*]`);
  the example resolves `@uni-helper/desktop` via `workspace:*`.
- `assembleDesktopApp` (`src/vite/driver.ts:126`) runs in `closeBundle` of the
  desktop build and writes `dist/build/desktop/electron/main.cjs`,
  `dist/build/desktop/web/index.html`, `dist/build/desktop/resources/icon.png`,
  `dist/build/desktop/package.json` — these are the CI assertions.
- electron-updater is a devDependency of the example; uni installs are heavy —
  the job needs a pnpm store cache, mirroring what sxzz's reusable workflows do
  (`pnpm/action-setup` + `actions/setup-node` with `cache: pnpm`).

House rules: keep the workflow minimal; do not add a matrix, do not enable the
commented coverage job.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Local dry-run of the CI path | `pnpm --filter @uni-helper/desktop-example-quick-start build:desktop` | exit 0 (from repo root, after `pnpm install` and `pnpm build`) |
| Assert artifacts | `test -f examples/quick-start/dist/build/desktop/electron/main.cjs && test -f examples/quick-start/dist/build/desktop/web/index.html` | exit 0 |

Note for the local dry-run: `pack.autoPack` defaults to true, so this invokes
electron-builder locally — that is fine on a dev machine (slow), and it is why
the CI job sets `pack.autoPack: false` (Step 1). If the local run's
electron-builder step fails on your machine, the assembly assertions above still
verify the part CI checks.

## Scope

**In scope**:
- `.github/workflows/ci.yml` (add one job)
- `examples/quick-start/unh.config.ts` (add `pack: { autoPack: false }` — see Step 1)

**Out of scope**:
- Do not touch the reusable `unit-test` job or its inputs (unverified schema).
- Do not add a macOS runner job for the darwin-only app-bundle tests
  (`test/app-bundle.test.ts` is darwin-gated and stays dev-machine-only).
- Do not bump the example's uni snapshot version here.

## Git workflow

- Branch: `advisor/007-ci-example-build`
- Commit: `ci: 增加 quick-start 真实 uni 构建链路检查`

## Steps

### Step 1: Make the example CI-packable

In `examples/quick-start/unh.config.ts`, add a `pack` key so CI (and any
`build:desktop` in an environment without signing setup) skips electron-builder:

```ts
    // CI runs the assembly only; electron-builder runs locally via autoPack.
    pack: {
      autoPack: false,
    },
```

Place it after the `window` key, keep the existing commented lines.

Wait — this changes the example's default for real users too (autoPack is
exactly what they want). Reconsider: instead, leave `unh.config.ts` untouched and
have CI override via env? There is no env override for autoPack. Decision: set
`autoPack: false` in the example config and document in the example README that
CI assembles only; a user cloning the example flips it to `true` (or deletes the
key) to get installers. Add that one line to
`examples/quick-start/README.md` if it exists (it does — one sentence:
「CI 中 `pack.autoPack` 默认关闭，只组装不打包；本地打包请改回 `true` 或删除该键。」),
creating no new files.

**Verify**: `pnpm --filter @uni-helper/desktop-example-quick-start build:desktop` → exit 0 and
`test -d examples/quick-start/dist/build/desktop/release` → exit 1 (release dir absent).

### Step 2: Add the CI job

In `.github/workflows/ci.yml`, append after the `unit-test` job (keep the
commented coverage block as-is):

```yaml
  example-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 12.8.1
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm --filter @uni-helper/desktop-example-quick-start build:desktop
      - name: Assert assembled artifacts
        run: |
          test -f examples/quick-start/dist/build/desktop/electron/main.cjs
          test -f examples/quick-start/dist/build/desktop/web/index.html
          test -f examples/quick-start/dist/build/desktop/resources/icon.png
          grep -q "uni-desktop" examples/quick-start/dist/build/desktop/electron/main.cjs
```

Notes:
- `pnpm/action-setup` reads `packageManager` from `package.json`; the explicit
  `version` input is redundant but harmless — prefer omitting `version` and
  letting it read `packageManager: pnpm@12.8.1`. Do omit it.
- `pnpm build` must run first: the example's `uniDesktop` plugin imports the
  built `dist/` of this package (workspace symlink), and the plugin's own
  startup self-check needs the package resolvable — the workspace install
  handles resolution, `pnpm build` handles freshness.
- The final `grep` asserts the bundled main process contains the uni-desktop
  runtime marker (`uni-desktop` logger tag appears in the bundled output —
  verified in `test/driver.test.ts` assertions style; if the grep string is not
  present in a real build output, replace with a string you verified locally
  from `examples/quick-start/dist/build/desktop/electron/main.cjs`, e.g.
  `desktop:uni:saveFile`).

**Verify** (workflow YAML only lints in CI, so validate locally):
`pnpm dlx. 2>/dev/null; node -e "const y=require('js-yaml')" 2>/dev/null || true` —
simplest reliable check: `npx --yes yaml-lint .github/workflows/ci.yml` if
available, else visual inspection + push. Record in the commit message that the
first CI run validates it.

### Step 3: Local end-to-end dry run

From the repo root:

**Verify**:
```sh
pnpm install && pnpm build \
  && pnpm --filter @uni-helper/desktop-example-quick-start build:desktop \
  && test -f examples/quick-start/dist/build/desktop/electron/main.cjs \
  && test -f examples/quick-start/dist/build/desktop/web/index.html \
  && echo CI-PATH-OK
```
→ prints `CI-PATH-OK`.

Then clean the artifacts so they don't dirty the tree:
`rm -rf examples/quick-start/dist` (they are untracked/build output).

## Test plan

No unit tests. The verification IS the local dry-run replicating the CI steps
exactly (Step 3) plus the first real CI run.

## Done criteria

- [ ] Step 3's dry run prints `CI-PATH-OK`
- [ ] `git status --short` shows only `.github/workflows/ci.yml`,
      `examples/quick-start/unh.config.ts`, `examples/quick-start/README.md` (if
      edited), and `plans/README.md`
- [ ] `pnpm lint` exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- The example build fails locally for a reason unrelated to this change (e.g.
  uni snapshot requires network to fetch its own deps) — report the error.
- `assembleDesktopApp` in a real uni build produces a different layout than the
  asserted artifacts (that would be a real finding — report it).

## Maintenance notes

- When uni releases a new version worth pinning, bump the example snapshot AND
  watch this job — it is the canary for resolver-order regressions.
- Reviewer scrutiny: the job must not run electron-builder (no `release` dir
  assertions, `autoPack: false`).
