import { createConsola } from 'consola'

/**
 * Shared logger for the dev/build/pack orchestration. The `uni-desktop` tag
 * keeps our lines distinguishable from the dev server and Electron output that
 * share the same terminal; `date: false` keeps them short. Consola picks the
 * fancy reporter only on a TTY, so CI output stays one plain line per message.
 */
export const logger = createConsola({
  defaults: { tag: 'uni-desktop' },
  formatOptions: { date: false },
})
