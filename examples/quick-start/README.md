# Quick start example

A minimal uni-app (Vue3 + Vite CLI) project demonstrating `@uni-helper/desktop`:

- `unh.config.ts` with window and app configuration under the `desktop` key
- a demo page exercising the APIs: clipboard and image picking (uni-h5 as-is), plus file persistence and `openDocument` (desktop shim)

## Run

```sh
pnpm install               # from the repo root
pnpm desktop:dev           # inside this directory: H5 dev server + Electron window
pnpm desktop:build         # H5 build + dist/build/desktop (installers in desktop/release)
```

The example depends on the workspace packages via `workspace:*`, so run it from within this repository.
