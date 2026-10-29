import process from 'node:process'

/** Print an error from a command and return the process exit code. */
export function printError(error: unknown): number {
  if (error instanceof Error && error.name === 'DesktopError') {
    console.error(`uni-desktop: ${error.message}`)
    return 1
  }
  console.error(error)
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
