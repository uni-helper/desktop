// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: false,
    antislop: true,
    ignores: ['.zcode/**'],
  },
  {
    files: ['packages/cli/src/**/*.ts', 'packages/core/src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
