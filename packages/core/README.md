# @uni-helper/desktop

SDK-configured Electron build and packaging for uni-app desktop apps.

This is the core package of the [uni-helper/desktop](https://github.com/uni-helper/desktop) monorepo:

- `defineConfig`: typed config for `unh.config.ts`, where all desktop options live under the `desktop` key; merged with `manifest.json` and the project `package.json` metadata
- `dev` / `build` / `pack` / `init`: programmatic orchestration used by the [CLI](../cli)
- Default Electron main process template and preload, plus `createDesktopApp` (exported from `./main`) for custom main processes
- electron-builder config generation from the desktop SDK config, including the exact `electronVersion` electron-builder needs

See the [root README](../../README.md) for the full documentation.
