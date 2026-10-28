import { describe, expect, it } from 'vitest'
import { createCli } from '../src/cli'
import { printError, withErrorHandling } from '../src/run'

function parse(args: string[]) {
  const cli = createCli()
  cli.parse(['node', 'uni-desktop', ...args], { run: false })
  return cli
}

describe('cli', () => {
  it('parses dev with a url override', () => {
    const cli = parse(['dev', '--url', 'http://localhost:3000'])
    expect(cli.options.url).toBe('http://localhost:3000')
  })

  it('parses build --no-pack', () => {
    const cli = parse(['build', '--no-pack'])
    expect(cli.options.pack).toBe(false)
  })

  it('parses init --no-install', () => {
    const cli = parse(['init', '--no-install'])
    expect(cli.options.install).toBe(false)
  })

  it('parses pack', () => {
    const cli = parse(['pack'])
    expect(cli.options).toMatchObject({})
  })
})

describe('printError', () => {
  it('formats desktop errors as one-liners', () => {
    const error = Object.assign(new Error('something failed'), { name: 'DesktopError' })
    expect(printError(error)).toBe(1)
  })

  it('returns 1 for generic errors', () => {
    expect(printError(new Error('boom'))).toBe(1)
  })
})

describe('withErrorHandling', () => {
  it('reports errors through the exit code instead of throwing', async () => {
    const action = withErrorHandling(async () => {
      throw Object.assign(new Error('nope'), { name: 'DesktopError' })
    })
    await expect(action()).resolves.toBeUndefined()
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
