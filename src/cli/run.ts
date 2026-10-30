import process from 'node:process'
import { createConsola } from 'consola'

/**
 * The CLI only reports errors, but they must look like the rest of the
 * `uni-desktop` output, so this instance mirrors the core logger config.
 */
const logger = createConsola({
  defaults: { tag: 'uni-desktop' },
  formatOptions: { date: false },
})

/** Print an error from a command and return the process exit code. */
export function printError(error: unknown): number {
  if (error instanceof Error && error.name === 'DesktopError') {
    logger.error(error.message)
    return 1
  }
  logger.error(error)
  return 1
}

/** Wrap an async command action with uniform error reporting. */
export function withErrorHandling<A extends unknown[]>(action: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await action(...args)
    }
    catch (error) {
      process.exitCode = printError(error)
    }
  }
}
