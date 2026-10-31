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
  it('normalizes h5.router while keeping conditional compilation', async () => {
    const root = await createProject({
      'package.json': PACKAGE_JSON,
      // uni-app manifest.json is JSONC with #ifdef conditional compilation;
      // normalizing h5.router must not drop the platform blocks. Note the
      // official constraint that the json stays valid, so no trailing commas.
      'src/manifest.json': `{
  "name": "commented-app",
  "h5": {
    "title": "Commented",
    "router": {
      "mode": "history"
    }
  },
  // #ifdef MP-WEIXIN
  "mp-weixin": { "appid": "wx123" }
  // #endif
}
`,
    })

    await init({ cwd: root, install: false })

    const manifest = await readFile(join(root, 'src/manifest.json'), 'utf8')
    expect(manifest).toContain('"mode": "hash"')
    expect(manifest).toContain('"base": "./"')
    expect(manifest).toContain('// #ifdef MP-WEIXIN')
    expect(manifest).toContain('"appid": "wx123"')
    expect(manifest).not.toContain('"mode": "history"')
  })

  it('leaves an already-normalized manifest untouched', async () => {
    const content = `{
  // The app name
  "name": "commented-app",
  "h5": { "router": { "mode": "hash", "base": "./" } }
}
`
    const root = await createProject({
      'package.json': PACKAGE_JSON,
      'src/manifest.json': content,
    })

    await init({ cwd: root, install: false })

    expect(await readFile(join(root, 'src/manifest.json'), 'utf8')).toBe(content)
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

    // Compiled builds only reach the shim through the vite plugin: uni rewrites
    // every `uni.xxx` call into an import from `@dcloudio/uni-h5`.
    const vite = await readFile(join(root, 'vite.config.ts'), 'utf8')
    expect(vite).toContain('import { uniDesktop } from \'@uni-helper/desktop/vite\'')
    expect(vite).toContain('plugins: [uni(), uniDesktop()]')
  })

  it('adds the uniDesktop plugin to an existing vite.config.ts', async () => {
    const root = await createProject({
      'package.json': PACKAGE_JSON,
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'vite.config.ts': `import uni from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [uni()],
})
`,
    })

    await init({ cwd: root, install: false })

    const vite = await readFile(join(root, 'vite.config.ts'), 'utf8')
    expect(vite).toContain('import { uniDesktop } from \'@uni-helper/desktop/vite\'')
    expect(vite).toContain('uniDesktop()')
    // The original config content survives the edit.
    expect(vite).toContain('uni()')
  })

  it('does not duplicate the uniDesktop plugin when it is already present', async () => {
    const root = await createProject({
      'package.json': PACKAGE_JSON,
      'src/manifest.json': JSON.stringify({ name: 'app' }),
      'vite.config.ts': `import { uniDesktop } from '@uni-helper/desktop/vite'
export default { plugins: [] }
`,
    })

    await init({ cwd: root, install: false })

    const vite = await readFile(join(root, 'vite.config.ts'), 'utf8')
    expect(vite.match(/@uni-helper\/desktop\/vite/g)).toHaveLength(1)
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
