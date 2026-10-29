import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../src/log'

const stdout = vi.spyOn(process.stdout, 'write')
const stderr = vi.spyOn(process.stderr, 'write')
const initialLevel = logger.level

afterEach(() => {
  logger.level = initialLevel
  stdout.mockClear()
  stderr.mockClear()
})

function written(spy: typeof stdout): string {
  return spy.mock.calls.map(([chunk]) => String(chunk)).join('')
}

describe('logger', () => {
  it('tags every message with the package name', () => {
    // `NODE_ENV=test` makes consola default to the `warn` level, so raise it
    // to exercise the formatting of the progress messages too.
    logger.level = 5
    logger.success('desktop app assembled')

    expect(written(stdout)).toContain('[uni-desktop]')
    expect(written(stdout)).toContain('desktop app assembled')
  })

  it('keeps output plain outside a TTY so CI logs stay readable', () => {
    logger.level = 5
    logger.info('waiting for the dev server')

    // Piped output must not contain ANSI escapes or TTY-only icons.
    expect(written(stdout)).not.toContain('\u001B[')
    expect(written(stdout)).toContain('waiting for the dev server')
  })

  it('routes warnings and errors to stderr', () => {
    logger.warn('h5.router.mode is "history"')
    logger.error('dev server did not become reachable')

    expect(written(stderr)).toContain('h5.router.mode is "history"')
    expect(written(stderr)).toContain('dev server did not become reachable')
    expect(written(stdout)).toBe('')
  })

  it('stays quiet below the configured level', () => {
    logger.info('dev server is ready')

    expect(written(stdout)).toBe('')
    expect(written(stderr)).toBe('')
  })
})
