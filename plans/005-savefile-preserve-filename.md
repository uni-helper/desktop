# Plan 005: Preserve saved-file identity — widen the MIME table and accept an optional fileName

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/shared/protocol.ts src/shim/apis/saved-file.ts src/runtime/index.ts test/runtime/index.test.ts test/shim/apis.test.ts test/protocol.test.ts`
> If those files changed since this plan was written, read them live; plans 002
> (runtime test harness) must have landed first.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-runtime-execution-tests.md (test harness); soft-depends
  on plan 001 in spirit only — no file overlap
- **Category**: direction (functional defect in an advertised flow)
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

The headline desktop flow — pick a document, `uni.saveFile` it, `uni.openDocument`
it with the OS default app — silently fails for exactly the documents users open
on desktop. `saveFile` sends only `{ bytes, mime }` (`src/shim/apis/saved-file.ts:38`);
the main process derives the extension solely from a fixed 15-entry MIME table
(`src/shared/protocol.ts:22-38`) and saves as `<uuid>.<ext>` — or `<uuid>` with
**no extension at all** when the MIME is unknown. `.docx` / `.xlsx` / `.pptx`
(Office OOXML MIME types) are not in the table, so `shell.openPath` has nothing
to resolve an association from and `uni.openDocument` fails on the user's
machine. Even in-table types lose their original extension history.

## Current state

`src/shared/protocol.ts` — the table and its reverse:

```ts
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.json': 'application/json', '.zip': 'application/zip',
}
export const EXTENSION_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_BY_EXTENSION).map(([extension, mime]) => [mime, extension]),
)
```

`src/runtime/index.ts:126-136` — the saveFile handler:
`const extension = mime ? EXTENSION_BY_MIME[mime] ?? '' : ''`, then
`join(savedRoot(), `${randomUUID()}${extension}`)`.

`src/shim/apis/saved-file.ts:30-41` — renderer `saveFile`: reads
`options.tempFilePath` via `fetch`, sends `{ bytes, mime }` over
`desktop:uni:saveFile`. `UniOptions` (`src/shim/types.ts`) has an index signature
(`[key: string]: unknown`), so extra keys flow through without type changes.

uni-h5's `chooseFile` results carry the original file name in `tempFiles[].name`
(on H5 the browser `File` object provides it) — but the shim deliberately does
not patch `chooseFile` (repo rule: only uni-h5-unimplemented APIs), so the shim
cannot capture the name implicitly. An explicit optional parameter is the honest
escape hatch for callers who have one; the widened table covers the common
browser-MIME cases with zero caller changes.

House rules: table entries are data, not code — no abstraction needed; the
extension decision stays a single expression in the handler.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shim tests | `pnpm build && pnpm exec vitest run test/shim/apis.test.ts` | all pass |
| Protocol tests | `pnpm build && pnpm exec vitest run test/protocol.test.ts` | all pass |
| Runtime tests | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint | `pnpm typecheck` / `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `src/shared/protocol.ts` (widen the table)
- `src/shim/apis/saved-file.ts` (accept + forward optional `fileName`)
- `src/runtime/index.ts` (extension decision: fileName → mime table → none)
- `test/protocol.test.ts`, `test/shim/apis.test.ts`, `test/runtime/index.test.ts`
- `README.md` (shim table + 文件路径 section)

**Out of scope**:
- Do NOT patch `uni.chooseImage/chooseVideo/chooseFile` (violates the repo's
  by-design shim rule: H5 implements them).
- Do NOT change `toDesktopFileUrl` / `parseDesktopFileUrl` / containment.
- Do NOT switch to preserving the full original file name on disk — saved files
  stay `<uuid><ext>`; only the extension is preserved.

## Git workflow

- Branch: `advisor/005-savefile-preserve-filename`
- Commit: `fix: saveFile 保留文件扩展名，补齐常见文档 MIME 并支持 fileName 覆盖`

## Steps

### Step 1: Widen the MIME table

In `src/shared/protocol.ts`, extend `MIME_BY_EXTENSION` with the document/media
types browsers actually report (keep alphabetical-ish grouping, one comment line
above the new entries):

```ts
  // Common document types: uni.saveFile → openDocument must round-trip the
  // files desktop users actually open, not just images and video.
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
```

`EXTENSION_BY_MIME` is derived, so it picks these up automatically. Note `.htm`
and `.html` map to the same MIME — the reverse map keeps the LAST one
(`.htm`); order the two entries so `.html` comes after `.htm` (as listed) and
accept that `text/html` round-trips to `.html`… actually it round-trips to
`.html` only if `.html` is the later entry — as listed above `.html` precedes
`.htm`, so reverse gives `.htm`. Decide once: place `.htm` BEFORE `.html` (swap
the two lines) so `text/html` → `.html`.

**Verify**: `pnpm build && pnpm exec vitest run test/protocol.test.ts` → passes.

### Step 2: Extend the runtime handler with the fileName fallback

In `src/runtime/index.ts` saveFile handler, replace the extension lines:

```ts
    const mime = typeof data.mime === 'string' ? data.mime : undefined
    const extension = mime ? EXTENSION_BY_MIME[mime] ?? '' : ''
```

with:

```ts
    const mime = typeof data.mime === 'string' ? data.mime : undefined
    // Extension priority: an explicit fileName (renderer-side escape hatch)
    // wins; the MIME table covers the types browsers report for chosen files.
    const fileName = typeof data.fileName === 'string' ? data.fileName : undefined
    const extension = extname(fileName ?? '') || (mime ? EXTENSION_BY_MIME[mime] ?? '' : '')
```

Add `extname` to the existing `node:path` import (`join, sep` today). `extname`
of a name with no dot returns `''`; of `.dotfile`-style names returns the whole
name — acceptable (same input produces the same output; containment is
unaffected since the name never contains a separator here — but guard the
pathological case: `extname` output containing a path separator is impossible by
Node's definition, so no extra check per house rules).

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → existing pins pass.

### Step 3: Forward an optional fileName from the renderer shim

In `src/shim/apis/saved-file.ts` `saveFile`, extend the invoke payload:

```ts
      const { bytes, mime } = await readAsBytes(options.tempFilePath)
      const fileName = typeof options.fileName === 'string' ? options.fileName : undefined
      return await getBridgeOrThrow().invoke(shimChannels.saveFile, { bytes, mime, fileName }) as { savedFilePath: string }
```

Add a short JSDoc line on `saveFile` noting `fileName` is a desktop-only extra
(`uni.saveFile` 的桌面扩展：指定原始文件名以保留扩展名).

**Verify**: `pnpm build && pnpm exec vitest run test/shim/apis.test.ts` → passes.

### Step 4: Tests

- `test/protocol.test.ts`, in `mimeFromExtension` block: add
  `.docx → 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'`
  and `text/html` reverse expectation via a saveFile-shaped check is runtime
  territory — keep this file to `mimeFromExtension` forward lookups plus one
  `EXTENSION_BY_MIME['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] === '.docx'`.
- `test/runtime/index.test.ts` (harness from plan 002): add two cases to the
  `'saved-file ipc handlers'` block:
  - `saveFile derives docx from the OOXML mime` — payload
    `{ bytes, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }`
    → the written file in `savedRoot()` ends `.docx`.
  - `saveFile prefers an explicit fileName extension` — payload
    `{ bytes, mime: 'application/octet-stream', fileName: '报告最终版.docx' }` →
    written file ends `.docx`; and `fileName: 'noext'` → written file has no
    extension (uuid only).
- `test/shim/apis.test.ts`: extend the saveFile happy-path test to assert
  `payload.fileName` is `undefined` when not given; add one case passing
  `{ tempFilePath, fileName: 'a.docx' }` asserting the payload carries it.

**Verify**: `pnpm test` → all pass.

### Step 5: README

- In the shim API table (section `## 垫片支持的 API`), `uni.saveFile` row:
  change the desktop-behavior cell to mention 保留扩展名（未知类型可传 `fileName` 指定）.
- In `### 文件路径`, append one sentence:
  「保存文件保留原始扩展名：优先取调用方传入的 `fileName`，否则按浏览器上报的 MIME 类型推导；都不已知时保存为无扩展名文件。」

**Verify**: `pnpm lint` → exit 0; `pnpm knip` → exit 0.

## Test plan

Five new/extended assertions across three existing test files (Step 4); no new
files. Pattern: existing describe blocks in each file.

## Done criteria

- [ ] `grep -n "docx" src/shared/protocol.ts` matches
- [ ] `grep -n "fileName" src/shim/apis/saved-file.ts src/runtime/index.ts` matches in both
- [ ] `pnpm test` exits 0 with the new tests present
- [ ] README updated in both places
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The OOXML MIME strings browsers report differ from the table (verify with a
  real chosen file before "fixing" the table — report what you observed).
- Plan 002's runtime harness is absent (STOP — this plan depends on it).

## Maintenance notes

- The table is the single source of truth for round-trippable types (`mimeFromExtension`
  serves `desktop-file://` responses from it); new shim file types start here.
- Reviewer scrutiny: extension derivation stays one expression; no filename
  sanitization rabbit hole (uuid names are deliberate — getSavedFileList exposes
  `filePath`, not friendly names).
