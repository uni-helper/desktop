import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  banner: '#!/usr/bin/env node',
})
