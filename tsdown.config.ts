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
      neverBundle: ['electron', 'electron-updater'],
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
    },
    platform: 'browser',
    fixedExtension: true,
    dts: true,
    publint: true,
    plugins: [
      StaleGuardRecorder(),
    ],
  },
])
