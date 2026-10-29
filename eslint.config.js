// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: false,
    antislop: true,
    vue: {
      sfcBlocks: false,
    },
    ignores: ['**/index.html'],
  },
  {
    files: ['packages/cli/src/**/*.ts', 'packages/core/src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['examples/**/*.vue', 'examples/**/*.ts'],
    languageOptions: {
      globals: {
        getCurrentPages: 'readonly',
        plus: 'readonly',
        uni: 'readonly',
        uniCloud: 'readonly',
      },
    },
  },
  {
    files: ['pnpm-workspace.yaml'],
    rules: {
      'yaml/plain-scalar': 'off',
    },
  },
)
