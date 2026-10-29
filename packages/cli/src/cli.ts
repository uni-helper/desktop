import { cac } from 'cac'
import pkg from '../package.json'
import { withErrorHandling } from './run'

export function createCli(): ReturnType<typeof cac> {
  const cli = cac('uni-desktop')

  cli
    .command('dev', 'Start the H5 dev server and launch an Electron window loading it')
    .option('--url <url>', 'Dev server URL, overrides `desktop.dev.url` from unh.config.ts')
    .action(withErrorHandling(async (options: { url?: string }) => {
      const { dev } = await import('@uni-helper/desktop')
      const handle = await dev({ cwd: process.cwd(), url: options.url })
      const shutdown = (): void => {
        void handle.close().then(() => process.exit(0))
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    }))

  cli
    .command('build', 'Build the H5 bundle and assemble the Electron app at dist/desktop')
    .option('--no-pack', 'Assemble dist/desktop without running electron-builder')
    .action(withErrorHandling(async (options: { pack?: boolean }) => {
      const { build } = await import('@uni-helper/desktop')
      await build({ cwd: process.cwd(), pack: options.pack })
    }))

  cli
    .command('pack', 'Package the built dist/desktop with electron-builder')
    .action(withErrorHandling(async () => {
      const { pack } = await import('@uni-helper/desktop')
      await pack({ cwd: process.cwd() })
    }))

  cli
    .command('init', 'Scaffold unh.config.ts, wire scripts and install dependencies')
    .option('--no-install', 'Skip installing the required dependencies')
    .action(withErrorHandling(async (options: { install?: boolean }) => {
      const { init } = await import('@uni-helper/desktop')
      await init({ cwd: process.cwd(), install: options.install })
    }))

  cli.help()
  cli.version(pkg.version)
  return cli
}
