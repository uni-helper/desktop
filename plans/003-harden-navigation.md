# Plan 003: Harden navigation — URL-origin checks and an openExternal scheme allowlist

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If any
> STOP condition occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` (unless a reviewer dispatched you
> and maintains the index).
>
> **Drift check (run first)**: `git diff --stat f02be02..HEAD -- src/runtime/index.ts test/runtime/index.test.ts`
> If those files changed since this plan was written, read them live before
> trusting the excerpts; plan 002 must have landed first (its test file is
> in-scope here).

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-runtime-execution-tests.md (the test harness pins
  current semantics; this plan consciously changes two pins)
- **Category**: security
- **Planned at**: commit `f02be02`, 2026-11-01

## Why this matters

`hardenNavigation` exists so the preload bridge (and with it the file IPC) is
never handed to a remote page. Two gaps defeat that intent:

1. **Prefix matching** (`src/runtime/index.ts:182,189`): `url.startsWith(devUrl)`
   is passed by `http://localhost:5173.evil.com` and `http://localhost:5173@evil.com/`.
   One XSS in dev can navigate the window (or `window.open` a new window with the
   same webPreferences) to a remote origin that still runs the bridge.
2. **Unvalidated `shell.openExternal`** (`src/runtime/index.ts:184,194`): every
   non-app URL of any scheme — `file:`, `ms-msdt:`-style OS handlers — is handed
   to the OS shell, the documented Electron footgun; and the `void` discards the
   promise, so a missing handler (common on Linux) becomes an unhandled rejection.
   Additionally, packaged mode's `will-navigate` allows navigation to **any**
   `file://` URL, not just the app's own web directory.

## Current state

`src/runtime/index.ts:180-196`:

```ts
function hardenNavigation(window: BrowserWindow, devUrl: string | undefined): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (devUrl && url.startsWith(devUrl))
      return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl))
      return
    if (!devUrl && url.startsWith('file://'))
      return
    event.preventDefault()
    void shell.openExternal(url)
  })
}
```

Context: `devUrl` comes from `process.env.DESKTOP_DEV_URL` (set by
`src/vite/driver.ts:78` as a bare origin like `http://localhost:5173`, produced by
`src/vite/index.ts:59-74`). Packaged apps have no env var and load
`join(__dirname, '../web/index.html')` (line 234). Existing imports at the top of
the file include `join, sep` from `node:path`. The runtime runs inside the asar:
`__dirname` is `.../app.asar/electron`, so the web dir is
`join(__dirname, '..', 'web')`.

Plan 002 created `test/runtime/index.test.ts` with a `'navigation hardening'`
describe block that pins the current semantics — including the deliberate pin
`packaged mode allows file navigation (current prefix semantics)` marked
`// Pinned deliberately; plan 003 scopes this to the app web dir.`

House rules (AGENTS.md): no speculative abstraction; a tiny local helper used
twice in one function is acceptable, exporting new helpers is not needed here.
Comments in English.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Single test file | `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `src/runtime/index.ts` (only `hardenNavigation` and its immediate needs)
- `test/runtime/index.test.ts` (update the navigation pins + add regression cases)

**Out of scope**:
- `src/vite/index.ts` / `src/vite/driver.ts` — how devUrl is produced is fine.
- The preload bridge, IPC channels — untouched.
- Do not add a URL allowlist config option; out of scope.

## Git workflow

- Branch: `advisor/003-harden-navigation`
- Commit: `fix: 导航加固改为 origin 级校验，openExternal 仅放行 http/https`

## Steps

### Step 1: Rewrite `hardenNavigation` with parsed-URL checks

Replace the function with:

```ts
/**
 * Keep the renderer on app-owned content: external links open in the system
 * browser and nothing can navigate the window away from the app. Without this
 * the preload bridge (and therefore the file IPC) would be handed to any
 * remote page the renderer navigates to. Checks compare parsed URLs, not
 * string prefixes: `http://localhost:5173.evil.com` must not pass a devUrl of
 * `http://localhost:5173`.
 */
function hardenNavigation(window: BrowserWindow, devUrl: string | undefined): void {
  const devOrigin = devUrl ? new URL(devUrl).origin : undefined
  // The packaged app's own pages, inside the asar; every other file:// url is
  // renderer-controlled content and must not load in this window.
  const webDir = join(__dirname, '..', 'web')

  const openExternal = (url: string): void => {
    const parsed = new URL(url)
    // Only web links go to the OS shell: other schemes reach OS handlers that
    // can execute content, and this window's renderer is not trusted.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return
    shell.openExternal(url).catch((error: unknown) => {
      logger.warn(`failed to open ${url}:`, error instanceof Error ? error.message : error)
    })
  }

  const isAppUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      if (devOrigin)
        return parsed.origin === devOrigin
      if (parsed.protocol !== 'file:')
        return false
      return join(fileURLToPath(parsed), sep) .startsWith(join(webDir, sep))
    }
    catch {
      return false
    }
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url))
      return { action: 'allow' }
    openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url))
      return
    event.preventDefault()
    openExternal(url)
  })
}
```

Fix the sketch's typo (`join(fileURLToPath(parsed), sep) .startsWith` → proper
spacing) and add `fileURLToPath` to the existing `node:url` import (the file
currently imports none from `node:url` — add
`import { fileURLToPath } from 'node:url'`). `logger` already exists at module
scope. Note the behavior change: previously non-app `will-navigate` in packaged
mode to a `file://` outside the web dir was *allowed*; now it is blocked and NOT
handed to openExternal (openExternal skips non-http/https, so nothing happens
beyond preventDefault — that is intended).

`new URL(devUrl)` can throw on a malformed env value; the current code would
never throw. Acceptable: a malformed DESKTOP_DEV_URL is a developer error — but
wrap ONLY the devOrigin computation in a try/catch falling back to `undefined`
with a `logger.warn`, to avoid crashing boot on a typo. Keep it to 3 lines.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Update the characterization pins and add regressions

In `test/runtime/index.test.ts`, `'navigation hardening'`:

- Remove the pin comment `// Pinned deliberately; plan 003 scopes this to the app web dir.`
  and change test 1 to assert the NEW behavior: packaged mode, navigate to
  `file:///etc/index.html` (outside the web dir) → `preventDefault` called and
  `openExternalUrls` does NOT grow.
- Keep test 2 (in-origin dev navigation allowed) as-is.
- Add regression cases:
  - `prefix lookalikes are blocked`: env devUrl `http://localhost:5173`, navigate
    to `http://localhost:5173.evil.com/` and `http://localhost:5173@evil.com/` →
    both prevented, neither in openExternalUrls (non-http… they ARE http — so
    they must be in openExternalUrls; blocked means prevented + deny for
    window.open; openExternal IS called with them, which is fine — assert
    `preventDefault` called).
  - `openExternal only receives web schemes`: trigger the deny path with
    `file:///etc/passwd` via `setWindowOpenHandler` → handler returns deny and
    `openExternalUrls` stays empty.
  - `packaged mode navigates within the web dir`: emit will-navigate with the
    URL of a real file you create under `join(userDataPath, 'electron', '..', 'web')`
    (create the dir and a file, then
    `import { pathToFileURL } from 'node:url'` → `pathToFileURL(filePath).href`)
    → `preventDefault` NOT called.

**Verify**: `pnpm build && pnpm exec vitest run test/runtime/index.test.ts` → all pass.

### Step 3: Gates

**Verify**: `pnpm test && pnpm typecheck && pnpm knip && pnpm lint` → all exit 0.

## Test plan

- Updated pins + 3 new regression cases in `test/runtime/index.test.ts` (Step 2).
- No new files. Existing suites must pass unchanged.

## Done criteria

- [ ] `grep -n "startsWith(devUrl)" src/runtime/index.ts` → no matches
- [ ] `grep -n "openExternal" src/runtime/index.ts` shows the http/https gate and the `.catch`
- [ ] `pnpm test` exits 0 with the new regression tests present
- [ ] No files outside the in-scope list modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Legitimate flows break that the tests don't cover and you cannot explain
  (e.g. the dev-server origin check rejects the real dev URL — report the
  actual URL shape from `src/vite/index.ts:59-74`).
- `fileURLToPath` on asar-internal paths behaves unexpectedly in tests (asar is
  not active in vitest; if the web-dir containment needs asar-aware logic,
  STOP and report instead of inventing it).

## Maintenance notes

- If a deep-link / custom-protocol feature is ever added, this allowlist is
  where its scheme gets added — deliberately.
- Reviewer scrutiny: confirm `openExternal` cannot receive `file:` or arbitrary
  schemes, and that the dev-origin comparison is `origin`-based, not string-based.
