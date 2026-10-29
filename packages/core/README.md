# @uni-helper/desktop

SDK-configured Electron build and packaging for uni-app desktop apps.

This is the core package of the [uni-helper/desktop](https://github.com/uni-helper/desktop) monorepo:

- `defineDesktopConfig`: typed config for `desktop.config.ts`, merged with `manifest.json` defaults
- `dev` / `build` / `pack` / `init`: programmatic orchestration used by the [CLI](../cli)
- Default Electron main process template and preload, plus `createDesktopApp` (exported from `./main`) for custom main processes
- electron-builder config generation from the desktop SDK config

See the [root README](../../README.md) for the full documentation.
