import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findAppBundle, patchAppBundle, prepareDevAppBundle, sanitizeBundleName, writeIcnsFromIcon } from '../src/orchestrate/app-bundle'

const tempRoots: string[] = []

async function newTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uni-desktop-app-bundle-'))
  tempRoots.push(dir)
  return dir
}

let root: string

beforeAll(async () => {
  root = await newTempRoot()
})

afterAll(async () => {
  await Promise.all(tempRoots.map(dir => rm(dir, { recursive: true, force: true })))
})

/** The built-in uni-helper icon, a real 1024x1024 png for sips to render. */
const ICON = fileURLToPath(new URL('../src/assets/icon.png', import.meta.url))

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Electron</string>
  <key>CFBundleDisplayName</key><string>Electron</string>
  <key>CFBundleIdentifier</key><string>com.github.Electron</string>
  <key>CFBundleVersion</key><string>45.0.0</string>
  <key>CFBundleIconFile</key><string>electron.icns</string>
</dict>
</plist>
`

/** A minimal stand-in for the electron dist bundle: right layout, fake files. */
async function createFakeBundle(parent: string): Promise<string> {
  const app = join(parent, 'dist', 'Electron.app')
  await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(join(app, 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(app, 'Contents', 'Info.plist'), PLIST)
  await writeFile(join(app, 'Contents', 'MacOS', 'Electron'), 'not a real binary')
  await writeFile(join(app, 'Contents', 'Resources', 'electron.icns'), 'original icns bytes')
  return app
}

describe('sanitizeBundleName', () => {
  it('keeps plain names', () => {
    expect(sanitizeBundleName('My App')).toBe('My App')
  })

  it('replaces path separators and collapses whitespace', () => {
    expect(sanitizeBundleName('a/b\\c:d  e')).toBe('a b c d e')
  })

  it('falls back when nothing usable remains', () => {
    expect(sanitizeBundleName('///')).toBe('app')
    expect(sanitizeBundleName('')).toBe('app')
  })
})

describe('findAppBundle', () => {
  it('walks up to the enclosing bundle', () => {
    const bundle = join(root, 'Electron.app')
    expect(findAppBundle(join(bundle, 'Contents', 'MacOS', 'Electron'))).toBe(bundle)
  })

  it('returns undefined outside a bundle', () => {
    expect(findAppBundle(join(root, 'node_modules', 'electron', 'cli.js'))).toBeUndefined()
  })
})

describe('prepareDevAppBundle', () => {
  it('falls back to the given binary outside an app bundle', async () => {
    const bare = join(root, 'node_modules', 'electron', 'dist', 'electron')
    expect(await prepareDevAppBundle({
      electronBinary: bare,
      appName: 'My App',
      appId: 'desktop.uniapp.my-app',
      icon: ICON,
      root,
    })).toBe(bare)
  })
})

// The rest runs the macOS dev tools (PlistBuddy, sips, iconutil) for real.
describe.skipIf(process.platform !== 'darwin')('patchAppBundle', () => {
  it('rewrites name, bundle id and icon', async () => {
    const app = await createFakeBundle(root)

    expect(await patchAppBundle(app, { appName: 'Test App', appId: 'desktop.uniapp.test-app', icon: ICON, sign: false })).toBe(true)

    const plist = join(app, 'Contents', 'Info.plist')
    expect(await printPlist(plist, 'CFBundleName')).toBe('Test App')
    expect(await printPlist(plist, 'CFBundleDisplayName')).toBe('Test App')
    expect(await printPlist(plist, 'CFBundleIdentifier')).toBe('desktop.uniapp.test-app')
    // Untouched keys survive.
    expect(await printPlist(plist, 'CFBundleVersion')).toBe('45.0.0')

    const icns = await readFile(join(app, 'Contents', 'Resources', 'electron.icns'))
    expect(icns.subarray(0, 4).toString('latin1')).toBe('icns')
    expect(icns.toString()).not.toContain('original icns bytes')
  }, 30_000)

  it('fails without an Info.plist to patch', async () => {
    const app = join(root, 'NotAnApp')
    await mkdir(app, { recursive: true })
    expect(await patchAppBundle(app, { appName: 'Test App', appId: 'desktop.uniapp.test-app', icon: ICON, sign: false })).toBe(false)
  })

  it('copies an .icns icon source as-is', async () => {
    const source = join(root, 'given.icns')
    const target = join(root, 'copied.icns')
    await writeFile(source, 'icns-bytes')

    expect(await writeIcnsFromIcon(source, target, root)).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('icns-bytes')
  })
})

describe.skipIf(process.platform !== 'darwin')('prepareDevAppBundle on darwin', () => {
  const devOptions = (root: string, appName: string) => ({
    electronBinary: join(root, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
    appName,
    appId: 'desktop.uniapp.my-app',
    icon: ICON,
    root,
    sign: false,
  })

  it('returns a patched clone inside the cache and reuses it', async () => {
    const projectRoot = await newTempRoot()
    await createFakeBundle(projectRoot)

    const binary = await prepareDevAppBundle(devOptions(projectRoot, 'My App'))
    expect(binary).toBe(join(projectRoot, 'dist', 'dev', 'desktop', 'electron-cache', 'My App.app', 'Contents', 'MacOS', 'Electron'))

    const marker = JSON.parse(await readFile(join(projectRoot, 'dist', 'dev', 'desktop', 'electron-cache', 'identity.json'), 'utf8'))
    expect(marker).toMatchObject({ electron: '45.0.0', appName: 'My App', appId: 'desktop.uniapp.my-app' })

    expect(await prepareDevAppBundle(devOptions(projectRoot, 'My App'))).toBe(binary)
  }, 30_000)

  it('rebuilds the clone when the app name changes', async () => {
    const projectRoot = await newTempRoot()
    await createFakeBundle(projectRoot)
    await prepareDevAppBundle(devOptions(projectRoot, 'My App'))

    const renamed = await prepareDevAppBundle(devOptions(projectRoot, 'Renamed'))
    expect(renamed).toBe(join(projectRoot, 'dist', 'dev', 'desktop', 'electron-cache', 'Renamed.app', 'Contents', 'MacOS', 'Electron'))
    await expect(readFile(renamed)).resolves.toBeTruthy()
  }, 30_000)
})

function printPlist(plist: string, key: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], (error, stdout) => {
      if (error)
        rejectPromise(error)
      else
        resolvePromise(stdout.trim())
    })
  })
}
