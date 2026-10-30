import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { init } from '../src/scaffold/init'

const tempDirs: string[] = []

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function createProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-init-'))
  tempDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, content)
  }
  return dir
}

const PACKAGE_JSON = JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2)

describe('init', () => {
  it('keeps manifest comments and trailing commas while normalizing h5.router', async () => {
    const root = await createProject({
      'package.json': PACKAGE_JSON,
      // uni-app itself parses manifest.json with jsonc-parser, so this file is
      // valid for the toolchain and must stay readable after `init`.
      'src/manifest.json': `{
  // The app name
  "name": "commented-app",
  "h5": {
    "title": "Commented",
    "router": {
      "mode": "history",
    },
  },
}
`,
    })

    await init({ cwd: root, install: false })

    const manifest = await readFile(join(root, 'src/manifest.json'), 'utf8')
    expect(manifest).toContain('// The app name')
    expect(manifest).toContain('"mode": "hash"')
    expect(manifest).toContain('"base": "./"')
  })

  it('creates unh.config.ts, desktop scripts and the shim import', async () => {
    const root = await createProject({
      'package.json': PACKAGE_JSON,
      'src/manifest.json': JSON.stringify({ name: 'my-app', h5: { router: { mode: 'hash', base: './' } } }),
      'src/main.ts': 'export function createApp() {}\n',
    })

    await init({ cwd: root, install: false })

    const config = await readFile(join(root, 'unh.config.ts'), 'utf8')
    expect(config).toContain('import { defineConfig } from \'@uni-helper/desktop\'')
    expect(config).toContain('name: \'my-app\'')

    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts).toMatchObject({
      'desktop:dev': 'uni-desktop dev',
      'desktop:build': 'uni-desktop build',
      'desktop:pack': 'uni-desktop pack',
    })

    const main = await readFile(join(root, 'src/main.ts'), 'utf8')
    expect(main.startsWith('import \'@uni-helper/desktop/shim\'\n')).toBe(true)
    expect(main).toContain('export function createApp()')
  })

  it('does not duplicate the shim import when it is already present', async () => {
    const root = await createProject({
      'package.json': PACKAGE_JSON,
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'src/main.ts': 'import \'@uni-helper/desktop/shim\'\nexport function createApp() {}\n',
    })

    await init({ cwd: root, install: false })

    const main = await readFile(join(root, 'src/main.ts'), 'utf8')
    expect(main.match(/@uni-helper\/desktop\/shim/g)).toHaveLength(1)
  })

  it('fails with a clear error outside a uni-app CLI project', async () => {
    const root = await createProject({ 'package.json': PACKAGE_JSON })

    await expect(init({ cwd: root, install: false })).rejects.toThrow('src/manifest.json not found')
  })
})
