import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(pkgRoot, 'src/templates')
const target = join(pkgRoot, 'dist/templates')

if (!existsSync(source)) {
  process.exit(0)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(dirname(target), { recursive: true })
cpSync(source, target, { recursive: true })

// The built-in app icon ships next to the bundled entry, like the templates.
const iconSource = join(pkgRoot, 'src/assets')
const iconTarget = join(pkgRoot, 'dist/assets')
if (existsSync(iconSource)) {
  rmSync(iconTarget, { recursive: true, force: true })
  cpSync(iconSource, iconTarget, { recursive: true })
}
