# Plan 012: Quote arguments on the Windows shell path of spawnAwait

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/orchestrate/pm.ts test/pm.test.ts`
> If those changed, read them live.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (platform: Windows)
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`spawnAwait` sets `shell: process.platform === 'win32'` (`src/orchestrate/pm.ts:55`).
With `shell: true`, Node concatenates `cmd` and `args` into a raw command string
with **no quoting** — so on Windows, `uni build -p desktop`'s electron-builder
invocation (`spawnAwait(process.execPath, [cli, '--config', configPath], ...)`,
`src/orchestrate/pack.ts:121`) breaks whenever any path contains a space. The
default Node install location alone (`C:\Program Files\nodejs\node.exe`)
guarantees it, with a confusing cmd.exe error instead of a build. The same
`spawnAwait` also runs dependency installs (`pnpm add -D ...`, `src/vite/setup.ts:149`)
where package names are space-free — but the quoting is harmless there.

Caveat (recorded honestly): confidence in the *failure* is MED — the Node
behavior is documented, but the exact fix deserves one Windows run. This plan
pins the string transform with unit tests and flags a Windows smoke test for the
maintainer.

## Current state

`src/orchestrate/pm.ts:50-67`:

```ts
export function spawnAwait(cmd: string, args: string[], options: { cwd: string }): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', (error) => {
      rejectPromise(new DesktopError(`failed to run \`${cmd} ${args.join(' ')}\`: ${error.message}`))
    })
    child.once('exit', (code) => {
      if (code === 0)
        resolvePromise()
      else
        rejectPromise(new DesktopError(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`))
    })
  })
}
```

Call sites: `src/orchestrate/pack.ts:121` (node.exe + script path + config path —
all space-prone), `src/vite/setup.ts:149` (package-manager CLI + package names).
Existing tests: `test/pm.test.ts` (44 lines — `detectPackageManager` and
`addCommand`; `spawnAwait` untested).

House rules: one small exported function used by one call site inside pm.ts is
justified here because it needs unit tests (it cannot be exercised on a darwin
dev machine); no more abstraction than that.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| New tests | `pnpm build && pnpm exec vitest run test/pm.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck / lint / knip | `pnpm typecheck` / `pnpm lint` / `pnpm knip` | exit 0 |

## Scope

**In scope**:
- `src/orchestrate/pm.ts` (quoting helper + use in `spawnAwait`)
- `test/pm.test.ts` (unit tests for the helper)

**Out of scope**:
- `src/orchestrate/pack.ts` / `src/vite/setup.ts` call sites (they benefit
  automatically).
- Do NOT switch to `shell: false` with `.cmd` resolution — that is a bigger
  behavioral change (PATH resolution semantics) and untestable here.

## Git workflow

- Branch: `advisor/012-windows-shell-quoting`
- Commit: `fix: Windows shell 分支为参数加引号，修复空格路径下打包失败`

## Steps

### Step 1: Add the quoting helper and use it

In `src/orchestrate/pm.ts`:

```ts
/**
 * cmd.exe (Node's `shell: true` on Windows) joins the command and arguments
 * with raw spaces, so any argument containing whitespace must carry its own
 * quotes. Doubling embedded quotes is cmd.exe's own escaping for `""` inside
 * a quoted string.
 */
export function quoteWindowsArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}
```

And in `spawnAwait`, when the shell is used, pass quoted args so Node's
concatenation produces a correct command line:

```ts
export function spawnAwait(cmd: string, args: string[], options: { cwd: string }): Promise<void> {
  const windowsShell = process.platform === 'win32'
  const effectiveArgs = windowsShell ? args.map(quoteWindowsArg) : args
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, effectiveArgs, {
      cwd: options.cwd,
      stdio: 'inherit',
      shell: windowsShell,
    })
    // ... rest unchanged (keep the error messages using the ORIGINAL args)
  })
}
```

Keep the `cmd} ${args.join(' ')}` error strings based on the original `args`
(readability of error messages beats shell-accuracy there).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Unit tests

In `test/pm.test.ts`, add a describe block:

```ts
describe('quoteWindowsArg', () => {
  it.each([
    ['plain', 'plain'],
    ['C:\\Program Files\\nodejs\\node.exe', '"C:\\Program Files\\nodejs\\node.exe"'],
    ['--config', '--config'],
    ['D:\\my app\\dist\\electron-builder.json', '"D:\\my app\\dist\\electron-builder.json"'],
    ['has"quote', '"has""quote"'],
    ['nospace"q x', '"nospace""q x"'],
  ])('quotes %j → %j', (input, expected) => {
    expect(quoteWindowsArg(input)).toBe(expected)
  })
})
```

(import `quoteWindowsArg` alongside the existing imports from
`../src/orchestrate/pm`.)

**Verify**: `pnpm build && pnpm exec vitest run test/pm.test.ts` → all pass.

### Step 3: Gates + maintainer flag

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

Add one line to `plans/README.md`'s status cell for this plan when marking DONE:
「已合入；Windows 真机 smoke test 待维护者执行一次 `uni build -p desktop`（路径含空格环境）」— the
plan template's status table allows a short note.

## Test plan

- `test/pm.test.ts`: `it.each` table over the quoting transform (Step 2) — the
  only machine-checkable surface on a darwin machine.
- Explicitly NOT verified here: an end-to-end Windows pack. Flagged in the index.

## Done criteria

- [ ] `grep -n "quoteWindowsArg" src/orchestrate/pm.ts` shows definition + use
- [ ] `pnpm test` exits 0 with the new quoting tests
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated with the Windows smoke-test note

## STOP conditions

- You find evidence the quoting breaks the *non-space* Windows case (e.g.
  pnpm.cmd argument splitting) — report; the fallback design (invoke the
  resolved `.cmd` via `shell: false`) is a bigger change needing the maintainer.

## Maintenance notes

- When a Windows CI runner or a maintainer Windows box is available, replace the
  string-transform pin with a real `spawnAwait('cmd', ['/c', 'echo', 'C:\\Program Files\\x'])`
  integration test.
- Reviewer scrutiny: POSIX path (`shell: false`) is untouched — confirm
  `effectiveArgs === args` there.
