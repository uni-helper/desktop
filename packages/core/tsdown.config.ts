import { defineConfig } from 'tsdown'
import { StaleGuardRecorder } from 'tsdown-stale-guard'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    main: 'src/runtime/index.ts',
  },
  external: ['electron', 'electron-updater'],
  dts: true,
  exports: true,
  publint: true,
  plugins: [
    StaleGuardRecorder(),
  ],
})
