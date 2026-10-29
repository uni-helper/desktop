import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/channels.ts'],
  platform: 'browser',
  fixedExtension: true,
  dts: true,
  exports: true,
  publint: true,
})
