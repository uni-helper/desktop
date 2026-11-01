# Plan 016: Add pack.win / pack.mac passthrough to electron-builder

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/types.ts src/config/resolve.ts src/orchestrate/pack.ts test/pack-config.test.ts`
> If those changed, read them live.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The product promise is "all packaging options live under `pack`", but anything
outside the `nsis`/`dmg`/`linux` blocks is inexpressible: macOS signing identity,
`hardenedRuntime`, `entitlements`, `notarize`, `category`; Windows
`signtoolOptions`, `signingHashAlgorithms`, `requestedExecutionLevel`. A user who
needs a signed/notarized mac build — the standard mac distribution bar — must
abandon the SDK's pack step and hand-maintain electron-builder config, undoing
the zero-CLI story exactly at the step that matters most. The pattern already
exists (three passthrough records); this plan adds the missing two.

## Current state

`src/types.ts:90-111` — `DesktopPackConfig` offers passthrough records only for
`nsis`, `dmg`, `linux` (lines 103–108) plus `publish`:

```ts
  /** Extra electron-builder `nsis` options */
  nsis?: Record<string, unknown>
  /** Extra electron-builder `dmg` options */
  dmg?: Record<string, unknown>
  /** Extra electron-builder `linux` options */
  linux?: Record<string, unknown>
```

`src/config/resolve.ts:158-167` — resolved `pack` carries the same three keys.

`src/orchestrate/pack.ts:66-88` — the `win`/`mac` blocks are hardcoded:

```ts
    win: {
      target: resolved.pack.targets.win ?? ['nsis'],
      icon,
    },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true, ...resolved.pack.nsis },
    mac: {
      target: resolved.pack.targets.mac ?? ['dmg'],
      icon,
    },
    ...(resolved.pack.dmg ? { dmg: resolved.pack.dmg } : {}),
    linux: {
      target: resolved.pack.targets.linux ?? ['AppImage'],
      category: 'Utility',
      icon,
      ...resolved.pack.linux,
    },
```

`test/pack-config.test.ts` — the tested surface confirms only nsis/dmg/linux
extras flow through (lines 54–72).

House rules: mirror the existing passthrough pattern exactly; spread AFTER the
computed keys so explicit user values win (same as `linux`, whose spread lets
users override `category`). Public type changes require tsnapi snapshot
regeneration (AGENTS.md).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Pack tests | `pnpm build && pnpm exec vitest run test/pack-config.test.ts` | all pass |
| Snapshot regen | `pnpm build && TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u` | snapshots updated |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/types.ts` (`DesktopPackConfig`: add `win?`, `mac?`)
- `src/config/resolve.ts` (`ResolvedConfig.pack`: add `win?`, `mac?`)
- `src/orchestrate/pack.ts` (spread into the blocks)
- `test/pack-config.test.ts` (new cases)
- `test/__snapshots__/tsnapi/**` (regenerate)
- `README.md` (配置 section)

**Out of scope**:
- `targets` stays the only way to change installer targets (the passthrough
  spreads after `target`, so a user COULD override `target` via `win.target` —
  that is acceptable and consistent with `linux`; do not special-case it).
- No signing secrets handling, no `csc` env plumbing — electron-builder's
  standard env vars work unchanged.

## Git workflow

- Branch: `advisor/016-pack-win-mac-passthrough`
- Commit: `feat: pack 增加 win/mac 透传配置，签名与公证选项可达`

## Steps

### Step 1: Types

`src/types.ts` — after the `dmg` passthrough line, add:

```ts
  /** Extra electron-builder `win` options (signing, requestedExecutionLevel, ...) */
  win?: Record<string, unknown>
  /** Extra electron-builder `mac` options (identity, hardenedRuntime, notarize, ...) */
  mac?: Record<string, unknown>
```

Order matters for review readability only; place `win` before `nsis` (matching
the builder config's block order: win, nsis, mac, dmg, linux).

**Verify**: `pnpm typecheck` → fails in resolve.ts/pack.ts until Step 2/3.

### Step 2: Resolve layer

`src/config/resolve.ts` resolved `pack` object: add
`win: config.pack?.win,` and `mac: config.pack?.mac,` next to the existing
`nsis`/`dmg`/`linux` lines; extend the inline `ResolvedConfig['pack']` type
(lines ~55-64) with `win?: Record<string, unknown>` and `mac?: Record<string, unknown>`.

**Verify**: `pnpm typecheck` → fails only in pack.ts usage (nothing yet reads them — typecheck may already pass; continue).

### Step 3: Builder config

`src/orchestrate/pack.ts`:

```ts
    win: {
      target: resolved.pack.targets.win ?? ['nsis'],
      icon,
      ...resolved.pack.win,
    },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true, ...resolved.pack.nsis },
    mac: {
      target: resolved.pack.targets.mac ?? ['dmg'],
      icon,
      ...resolved.pack.mac,
    },
```

**Verify**: `pnpm build && pnpm exec vitest run test/pack-config.test.ts` → existing tests pass.

### Step 4: Tests

In `test/pack-config.test.ts`, extend the existing `uses the updater feed ...`
test's config with `pack: { ..., win: { signingHashAlgorithms: ['sha256'] }, mac: { hardenedRuntime: true } }`
and add assertions:

```ts
    expect((config as any).win.signingHashAlgorithms).toEqual(['sha256'])
    expect((config as any).mac.hardenedRuntime).toBe(true)
```

Add one more focused case: `win passthrough can override the default target`
(`win: { target: ['zip'] }` → `(config as any).win.target` equals `['zip']`),
documenting the deliberate override semantics.

**Verify**: `pnpm build && pnpm exec vitest run test/pack-config.test.ts` → all pass.

### Step 5: Snapshots + README

- Regenerate: `pnpm build && TSNAPI_ALLOW_BREAKING=1 pnpm exec vitest run test/api-snapshot.test.ts -u`
  → `index.snapshot.d.ts` gains the two optional fields.
- `README.md` 配置 section, in the example `pack` block, add two commented lines:

```ts
      win: { signingHashAlgorithms: ['sha256'] }, // electron-builder win 透传（签名等）
      mac: { hardenedRuntime: true }, // electron-builder mac 透传（签名/公证等）
```

And in the paragraph after the example (the one explaining electron-builder
config), ensure nothing contradicts; add one sentence:
「`pack.win` / `pack.mac` 会透传给 electron-builder 的同名配置，用于签名、公证等平台选项；写在后面的用户值覆盖默认的 `target`/`icon`。」

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

Two new assertions in the existing passthrough test + one override case
(Step 4); snapshot regen is the public-API gate.

## Done criteria

- [ ] `grep -n "resolved.pack.win\|resolved.pack.mac" src/orchestrate/pack.ts` matches
- [ ] `pnpm test` exits 0 including regenerated snapshots
- [ ] README documents both keys
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The snapshot diff shows unrelated public-API churn (someone landed mid-flight).
- The example config or `test/pack-config.test.ts` drifted from the excerpts.

## Maintenance notes

- Future per-platform extras (e.g. `nsis` include list) already have homes; new
  electron-builder top-level keys (e.g. `afterSign` hooks) are NOT covered by
  this passthrough — that stays out of scope until requested.
- Reviewer scrutiny: spread order (user values after computed values) and that
  `icon`/`target` defaults survive when no passthrough is given.
