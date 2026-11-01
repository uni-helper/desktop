# Plan 015: Bound the saveFile IPC payload at the main-process handler

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/runtime/index.ts test/runtime/index.test.ts`
> If those changed, read them live. Plans 002 (harness) and 005 (extension) touch
> the same handler — 005 must have landed (or be merged with this plan).

## Status

- **Priority**: P3 (user-approved defense; exploitation requires a compromised renderer)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-runtime-execution-tests.md (harness); coordinate with
  plan 005 (same handler)
- **Category**: security
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The `saveFile` IPC handler accepts any `Uint8Array`/`ArrayBuffer` of any size and
writes it into the managed directory under a fresh UUID, with no size cap and no
quota. Under the repo's own threat model (the `hardenNavigation` comment treats a
renderer holding the bridge as the attacker), a compromised renderer can spike
main-process memory with an arbitrarily large IPC payload and fill the userData
disk with unbounded, never-pruned files. A generous size cap and a file-count cap
cannot affect legitimate `uni.saveFile` usage (chosen images/videos/docs) beyond
returning the documented `saveFile:fail` — that is exactly why this passed the
防过度防御 review and was approved.

## Current state

`src/runtime/index.ts:126-137` (after plan 005's extension line):

```ts
  ipcMain.handle(shimChannels.saveFile, async (_event, payload) => {
    const data = assertObjectPayload(payload)
    const bytes = data.bytes
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer))
      throw new TypeError('bytes must be a Uint8Array or ArrayBuffer')
    const mime = typeof data.mime === 'string' ? data.mime : undefined
    // ... extension derivation (plan 005)
    await mkdir(savedRoot(), { recursive: true })
    const target = join(savedRoot(), `${randomUUID()}${extension}`)
    await writeFile(target, bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
    return { savedFilePath: toDesktopFileUrl(target) }
  })
```

The handler throws plain `TypeError`/`Error` — the renderer's `invokeUniApi`
(`src/shim/result.ts:5-10`) converts anything thrown into
`{ errMsg: 'saveFile:fail <message>' }`, so caps surface to callers as normal uni
failures with zero shim changes.

`test/runtime/index.test.ts` (plan 002) has the `'saved-file ipc handlers'`
block with the harness (`state.ipcHandlers`, `userDataPath`, `savedRoot()`).

House rules: two module-level constants + two inline checks; no config surface,
no pruning job (a count cap at write time is enough; background pruning is
speculative).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Runtime tests | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/runtime/index.ts` (constants + two checks in the saveFile handler)
- `test/runtime/index.test.ts` (three new cases)
- `README.md` (### 文件路径 — one sentence documenting the caps)

**Out of scope**:
- The preload bridge and channel allowlist (unchanged).
- No user-configurable limit (YAGNI; revisit only on a real request).
- No changes to `getSavedFileList`/`removeSavedFile` (the count cap enforces itself
  on new writes; existing over-quota files remain removable — by design).

## Git workflow

- Branch: `advisor/015-savefile-payload-limits`
- Commit: `fix: saveFile IPC 增加大小与数量上限，遏制被攻陷渲染进程的滥用面`

## Steps

### Step 1: Add the caps

Near `savedRoot()` in `src/runtime/index.ts`, add:

```ts
/**
 * Renderer-supplied bytes are untrusted input even though only the app's own
 * pages hold the bridge: caps bound the blast radius of a compromised renderer
 * (main-process memory spike, userData disk fill) without touching legitimate
 * saveFile usage. 512 MB covers any real chosen video; 2000 files covers any
 * real app's managed files.
 */
const MAX_SAVE_BYTES = 512 * 1024 * 1024
const MAX_SAVED_FILES = 2000
```

In the saveFile handler, after the bytes-type check:

```ts
    const byteLength = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength
    if (byteLength > MAX_SAVE_BYTES)
      throw new Error(`file exceeds the ${MAX_SAVE_BYTES} byte limit`)
```

(The ternary is silly — simplify to `if (bytes.byteLength > MAX_SAVE_BYTES)`:
`ArrayBuffer` and `Uint8Array` both expose `byteLength`. Write it that way.)

And before the `mkdir`, count the directory (one `readdir` per save is cheap
relative to writing megabytes):

```ts
    await mkdir(savedRoot(), { recursive: true })
    if ((await readdir(savedRoot())).length >= MAX_SAVED_FILES)
      throw new Error(`the managed file directory is full (max ${MAX_SAVED_FILES} files)`)
```

(`readdir` is already imported in the file.) Keep both messages lowercase
`saveFile:fail`-friendly — the renderer prefixes the channel-agnostic
`saveFile:fail ` automatically.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Tests

In `test/runtime/index.test.ts`, `'saved-file ipc handlers'` block:

1. `saveFile rejects oversized payloads` —
   `handler({}, { bytes: new Uint8Array(512 * 1024 * 1024 + 1), mime: 'image/png' })`
   → rejects with `exceeds`. (512 MB + 1 zero-filled Uint8Array is fine in a
   test process; if memory pressure is a concern, allocate with
   `new Uint8Array(1)` and monkey-... no — just allocate it, Node handles a
   sparse-typed 512 MB allocation; record actual behavior.)
2. `saveFile enforces the file count cap` — create a temp `userDataPath`, write
   `MAX_SAVED_FILES` is too many real files for a test; instead read the
   constant (export it? NO — house rules). Alternative: make the count
   observable by writing files until the cap: do NOT. Pragmatic approach:
   export the two constants (`export const MAX_SAVE_BYTES`/`MAX_SAVED_FILES`)
   — two tiny exports, knip-clean because the test imports them, and they
   document the boundary. Adjust Step 1 to export them. Then the test:
   `mkdir(savedRoot())`, create `MAX_SAVED_FILES` dummy files with
   `writeFile(join(savedRoot(), `f${i}.txt`), 'x')` in a loop (2000 tiny files
   is fast), invoke handler with a 1-byte payload → rejects with `full`.
   If 2000 files proves too slow in CI (>2 s), halve by overriding... you
   cannot override a const — then switch the constant to a `let` is ugly; the
   cleanest fallback is looping 2000 files anyway (report the duration).
3. `saveFile still succeeds under the caps` — the existing happy-path test
   already covers this; assert it still passes.

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → all pass.

### Step 3: README

In `README.md` `### 文件路径`, append:

> 桌面垫片对 `uni.saveFile` 设有上限：单文件 512 MB、管理目录内最多 2000 个文件，超出返回 `saveFile:fail`。

**Verify**: `pnpm lint` → exit 0; `pnpm knip` → exit 0 (the exported constants
are consumed by the test).

### Step 4: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

Three new cases in the runtime suite (Step 2). The count-cap test is the only
novel shape (bulk file creation); the size-cap test is one rejection assertion.

## Done criteria

- [ ] `grep -n "MAX_SAVE_BYTES\|MAX_SAVED_FILES" src/runtime/index.ts` shows both
- [ ] `pnpm test` exits 0 with the three new cases
- [ ] README 文件路径 section documents both caps
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The 2000-file count test takes materially long (>5 s) — report the measured
  time and stop; the maintainer may prefer lowering the constant or accepting
  the cap without that test.
- IPC-level enforcement already exists somewhere (structured-clone limits) that
  makes the size cap unreachable — report what you found.

## Maintenance notes

- If uni later defines an official saveFile size limit, align the constant with
  the spec rather than this plan's number.
- Reviewer scrutiny: caps throw plain `Error`s so the renderer's existing
  `errMsg: 'saveFile:fail ...'` conversion applies unchanged.
