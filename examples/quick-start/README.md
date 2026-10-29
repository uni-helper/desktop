# Quick start example

A minimal uni-app (Vue3 + Vite CLI) project demonstrating `@uni-helper/desktop`:

- `desktop.config.ts` with window and app configuration
- the desktop shim wired in `src/main.ts`
- a demo page exercising the shimmed APIs: clipboard, native image picker, file persistence and `openDocument`

## Run

```sh
pnpm install               # from the repo root
pnpm desktop:dev           # inside this directory: H5 dev server + Electron window
pnpm desktop:build         # H5 build + dist/desktop + installers in dist/release
```

The example depends on the workspace packages via `workspace:*`, so run it from within this repository.
