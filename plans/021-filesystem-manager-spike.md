# Plan 021: Spike — uni.getFileSystemManager shim subset

> **Executor instructions**: This is a DESIGN/SPIKE plan. The deliverable is a
> written design document plus a thin prototype, NOT a finished feature. Do not
> implement the full API. When done, update the status row for this plan in
> `plans/README.md` (unless a reviewer dispatched you and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/shim/ src/runtime/index.ts src/shared/protocol.ts`
> Read the live files; plans 005/015/017/018 evolve the shim/channel surface.

## Status

- **Priority**: P3
- **Effort**: L (spike scoped to a design doc + prototype of 2 methods)
- **Risk**: MED (new file-IO IPC is a security-sensitive surface)
- **Depends on**: plans/002 (runtime harness), plans/015 (payload caps — the FS
  manager inherits their philosophy), plans/017/018 (channel-group patterns)
- **Category**: direction (design/spike)
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`uni.getFileSystemManager` is the largest uni API family uni-h5 does not
implement (0 occurrences in the example's `uni-h5.es.js` — verified), so it is
squarely inside the repo's own shim rule. Any desktop app doing real local-file
work (import/export, project files, logs, config) hits it and gets nothing,
forcing `nodeIntegration` hacks that break the 「标准 uni.xxx 写法、跨端零改动」
promise. The hard infrastructure already exists: bytes-over-IPC, realpath
containment (`pathFromManagedValue`), the `desktop-file://` privileged protocol,
and a deny-by-default allowlist. The open questions are scope and root policy —
exactly what a spike should settle before anyone writes the full API.

## Current state (the infrastructure to reuse)

- `src/runtime/index.ts` — `pathFromManagedValue(value, roots, label)` (realpath
  + root containment, symlink-aware), `savedRoot()` =
  `join(app.getPath('userData'), 'uni-desktop-files')`, per-handler validation
  via `assertObjectPayload`, `MAX_SAVE_BYTES`/`MAX_SAVED_FILES` (after plan 015).
- `src/shim/` — `channels.ts` groups (`shimChannels` = uni-API channels →
  automatic wrapper exports via `src/vite/index.ts:27`; separate groups for
  window/updater per plans 017/018), `result.ts` `invokeUniApi` (callback +
  Promise styles), `patch.ts` (uni-object patching), `bridge.ts`.
- uni's FileSystemManager spec (to be read during the spike from the project's
  `@dcloudio/types` — `node_modules/@dcloudio/types/uni-nvue.d.ts` or the
  `uni.d.ts` FileSystemManager interface): methods include `readFile`,
  `writeFile`, `appendFile`, `unlink`, `mkdir`, `rmdir`, `readdir`, `stat`,
  `access`, `copyFile`, `rename`, plus path forms (`USER_DATA_PATH`,
  `TEMP_PATH` constants on the manager).

## Deliverables

Write `docs/design/fs-manager.md` (create the `docs/design/` directory) with
these sections, then prototype 2 methods end-to-end:

1. **Method subset for v1** — recommend from:
   `readFile` / `writeFile` / `appendFile` / `unlink` / `mkdir` / `readdir` /
   `stat` / `access` (the read-write core). Explicitly DEFER: `copyFile`,
   `rename`, `rmdir`, zip/compress, watchers (`onFileChange`-style), and the
   sync variants (`*Sync` — decide: trivial wrappers or out of scope?).
   Justify each deferral in one line.
2. **Root policy** — the central design question. Candidate policy to evaluate:
   v1 roots = the app-managed saved directory (`savedRoot()`) ONLY, with
   `USER_DATA_PATH` mapped onto it; every path argument goes through
   `pathFromManagedValue`. Evaluate and document: (a) can a user file ever
   legitimately leave that root in v1? (b) how `uni.env.USER_DATA_PATH` /
   `TEMP_PATH` constants surface on the manager; (c) whether `chooseFile`
   results (blob: URLs, NOT paths) need a `saveFile`-style bridge before FS
   access — recommend the flow: choose → saveFile → FS operate on the
   `desktop-file://` result.
3. **Channel shape** — one invoke channel per method
   (`desktop:uni:fs:readFile` etc.) in a `fsChannels` group, or one channel
   with an op field? Recommend one-per-method (allowlist granularity, matches
   the existing pattern). Payload sketches per method (bytes as
   Uint8Array like `saveFile`; encoding handling — `readFile` `encoding`
   option done renderer-side from bytes).
4. **Limits** — inherit `MAX_SAVE_BYTES`; per-file write cap identical; decide
   whether the FS manager shares `MAX_SAVED_FILES` or needs its own quota per
   root.
5. **Error model** — every failure as `errMsg: '<method>:fail ...'` via
   `invokeUniApi`; list the errno-style messages worth matching from uni's spec.
6. **Security analysis** — one page: threat (compromised renderer), containment
   (realpath roots), the one new risk v1 adds (write primitive inside the root
   — bounded by the cap), and what is explicitly NOT granted (arbitrary paths,
   exec, symlinks creation).
7. **Prototype** — implement `readFile` + `writeFile` end-to-end behind the
   patterns above (channel, main handler with containment, renderer shim with
   `invokeUniApi`, `patchUni` registration, harness tests in
   `test/runtime/index.test.ts` + a `test/shim/fs.test.ts`), marked clearly as
   prototype (may ship — the design doc says whether to keep or evolve).

House rules apply fully: the prototype follows the saved-file pattern
(`src/shim/apis/saved-file.ts` + the runtime's file handlers) with zero new
infrastructure; no speculative methods beyond the two.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shim tests | `pnpm build && pnpm exec vitest run test/shim/` | all pass |
| Runtime tests | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `docs/design/fs-manager.md` (create — the primary deliverable)
- `src/shim/channels.ts`, `src/shim/apis/fs.ts` (create), `src/shim/apis/index.ts`,
  `src/shim/patch.ts`
- `src/runtime/index.ts` (two handlers inside `registerIpcHandlers`)
- `test/shim/fs.test.ts` (create), `test/runtime/index.test.ts` (two handler pins)
- README shim table: only if the prototype is kept (one row, marked 初期子集)

**Out of scope**:
- The full FileSystemManager surface, sync variants, watchers, zip — DEFER.
- Any relaxation of `pathFromManagedValue` (no new roots without the design doc's
  conclusion; do not "temporarily" widen roots).
- `docs/design/` must contain ONLY this file.

## Git workflow

- Branch: `advisor/021-fs-manager-spike`
- Commit: `docs: getFileSystemManager 垫片设计稿与 readFile/writeFile 原型`

## Steps

### Step 1: Read the uni spec shape

From the example's installed `@dcloudio/types`, extract the `FileSystemManager`
interface and the `USER_DATA_PATH`/`TEMP_PATH` env constants. Record the exact
method signatures the v1 subset must honor (readFile's `{ filePath, encoding,
position?, length? }`, writeFile's `{ filePath, data, encoding }`, etc.) in the
design doc, section 1.

**Verify**: the design doc cites the installed types file path it read.

### Step 2: Write the design doc

All seven sections from Deliverables. Every recommendation gets a one-line
trade-off; every deferral gets a one-line justification. The doc is in Chinese
(README language) with English identifiers.

**Verify**: `pnpm lint` → exit 0 (markdown linted).

### Step 3: Prototype readFile + writeFile

Follow the saved-file pattern end-to-end (channels → runtime handler with
`pathFromManagedValue(data.filePath, [savedRoot()], 'filePath')` → renderer
`fs.ts` with `invokeUniApi` → `patchUni` registration). `readFile` returns
bytes (renderer-side `encoding` conversion); `writeFile` accepts string or
Uint8Array data, applies `MAX_SAVE_BYTES`.

**Verify**: `pnpm build && pnpm exec vitest run test/shim/ test/runtime/index.test.ts` → all pass.

### Step 4: Tests + gates

- `test/shim/fs.test.ts`: happy path, containment rejection (outside-root path),
  callback style, no-bridge failure — modeled on `test/shim/apis.test.ts`.
- `test/runtime/index.test.ts`: two handler pins — write inside root succeeds,
  traversal via `desktop-file://` URL rejected.

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

Four prototype tests (Step 4). The design doc's section 7 states whether the
prototype ships or is parked behind the doc's conclusion.

## Done criteria

- [ ] `docs/design/fs-manager.md` exists with all seven sections
- [ ] `pnpm test` exits 0 with the prototype tests
- [ ] The prototype handles only `readFile`/`writeFile` (grep confirms no other
      fs methods leaked into `channels.ts`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The installed `@dcloudio/types` lacks a FileSystemManager interface (uni spec
  moved — report and re-scope the doc to the observed shape).
- The containment requirement forces infrastructure changes beyond
  `pathFromManagedValue` (that is a finding, not a prototype concern — report).

## Maintenance notes

- The full implementation plan (if the spike is approved) should reference this
  doc's section 3 channel shape and section 4 limits verbatim.
- Reviewer scrutiny: the design doc's root policy section is the review target —
  the code is just two handlers.
