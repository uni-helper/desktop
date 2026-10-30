import process from 'node:process'
import { cac } from 'cac'
import pkg from '../../package.json'
import { withErrorHandling } from './run'

export function createCli(): ReturnType<typeof cac> {
  const cli = cac('uni-desktop')

  cli
    .command('dev', 'Start the H5 dev server and launch an Electron window loading it')
    .option('--url <url>', 'Dev server URL, overrides `desktop.dev.url` from unh.config.ts')
    .action(withErrorHandling(async (options: { url?: string }) => {
      const { dev } = await import('../index')
      const handle = await dev({ cwd: process.cwd(), url: options.url })
      const shutdown = (): void => {
        void handle.close().then(() => process.exit(0))
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    }))

  cli
    .command('build', 'Build the H5 bundle and assemble the Electron app at dist/desktop')
    .option('--pack', 'Run electron-builder after assembling, overriding `pack.autoPack`')
    .option('--no-pack', 'Assemble dist/desktop without running electron-builder')
    .action(withErrorHandling(async (options: { pack?: boolean }) => {
      const { build } = await import('../index')
      await build({ cwd: process.cwd(), pack: explicitPackFlag(process.argv, options.pack) })
    }))

  cli
    .command('pack', 'Package the built dist/desktop with electron-builder')
    .allowUnknownOptions()
    .action(withErrorHandling(async (options: { [key: string]: unknown }) => {
      const { pack } = await import('../index')
      await pack({ cwd: process.cwd(), args: passthroughArgs(options) })
    }))

  cli
    .command('init', 'Scaffold unh.config.ts, wire scripts and install dependencies')
    .option('--no-install', 'Skip installing the required dependencies')
    .action(withErrorHandling(async (options: { install?: boolean }) => {
      const { init } = await import('../index')
      await init({ cwd: process.cwd(), install: options.install })
    }))

  cli.help()
  cli.version(pkg.version)
  return cli
}

/**
 * Rebuild the raw arguments `cac` parsed so `uni-desktop pack -- --publish always`
 * forwards unknown options to electron-builder untouched.
 */
function passthroughArgs(options: Record<string, unknown>): string[] {
  const raw = options['--']
  return Array.isArray(raw) ? raw.map(String) : []
}

/**
 * `cac` always materializes `--no-pack` as `pack: true`, so a default run looks
 * identical to an explicit `--pack`. Only an explicit flag may override the
 * `pack.autoPack` config value; otherwise `build` must see `undefined`.
 */
export function explicitPackFlag(argv: string[], _parsed: boolean | undefined): boolean | undefined {
  if (argv.includes('--no-pack'))
    return false
  if (argv.includes('--pack'))
    return true
  return undefined
}
