// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: false,
    typescript: true,
    antislop: true,
    vue: {
      sfcBlocks: false,
    },
    // `plans/` holds generated planning documents, not code.
    ignores: ['**/index.html', 'plans'],
  },
  {
    files: ['src/**/*.ts'],
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
