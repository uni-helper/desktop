import { defineConfig } from 'tsdown'
import { StaleGuardRecorder } from 'tsdown-stale-guard'

/**
 * Output hashing is off: the three configs build in parallel into one `dist`,
 * so every recorder walks a directory the other builds are still writing, and
 * on Windows that `open()` dies with EBUSY (`dist/assets/icon.png`, seen on
 * node 26). Source, tsdown config and lockfile hashes are still recorded.
 */
const staleGuard = () => StaleGuardRecorder({ hashOutputs: false })

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'runtime/index': 'src/runtime/index.ts',
    },
    deps: {
      // `vite` is a devDependency used only for types in `src/vite`; consumers
      // always run the plugin inside their own vite, where the types resolve.
      neverBundle: ['electron', 'electron-updater', 'vite'],
    },
    dts: true,
    publint: true,
    // Templates and the built-in app icon ship next to the bundled entries.
    // Out dir is cleaned once per run, so one config is enough.
    copy: ['src/templates', 'src/assets'],
    plugins: [
      staleGuard(),
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
      staleGuard(),
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
      staleGuard(),
    ],
  },
])
