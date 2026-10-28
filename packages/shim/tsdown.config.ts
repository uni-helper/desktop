import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'browser',
  fixedExtension: true,
  dts: true,
  exports: true,
  publint: true,
})
