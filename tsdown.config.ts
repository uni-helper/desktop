import { defineConfig } from 'tsdown'
import { StaleGuardRecorder } from 'tsdown-stale-guard'

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'runtime/index': 'src/runtime/index.ts',
      'cli': 'src/cli/index.ts',
    },
    deps: {
      // `vite` is a devDependency used only for types in `src/vite`; consumers
      // always run the plugin inside their own vite, where the types resolve.
      neverBundle: ['electron', 'electron-updater', 'vite'],
    },
    // Only the `uni-desktop` bin gets a shebang; index.mjs is imported by
    // user tooling and must stay a plain ES module.
    banner: ({ fileName }) => fileName.startsWith('cli.') ? '#!/usr/bin/env node' : undefined,
    dts: true,
    publint: true,
    plugins: [
      StaleGuardRecorder(),
    ],
  },
  {
    entry: {
      'shim/index': 'src/shim/index.ts',
      'shim/channels': 'src/shim/channels.ts',
      'shim/apis': 'src/shim/apis/index.ts',
    },
    platform: 'browser',
    fixedExtension: true,
    dts: true,
    publint: true,
    plugins: [
      StaleGuardRecorder(),
    ],
  },
  {
    // The vite plugin runs inside the user's vite config, which older vite
    // versions load through `require` when the project is not `"type":
    // "module"`. The CJS twin keeps that path working.
    entry: {
      'vite/index': 'src/vite/index.ts',
    },
    format: ['esm', 'cjs'],
    deps: {
      neverBundle: ['vite'],
    },
    dts: true,
    publint: true,
    plugins: [
      StaleGuardRecorder(),
    ],
  },
])
