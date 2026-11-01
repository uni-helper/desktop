import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Directory holding the shipped `main.ts` / `preload.ts` templates.
 *
 * The same module is loaded from `src/shared` (tests) and from the bundled
 * `dist/index.mjs` (published), where the templates sit one level up or next
 * to the entry, so both layouts are probed instead of hardcoding one.
 */
export function getTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [join(here, 'templates'), join(here, '..', 'templates')]) {
    if (existsSync(join(candidate, 'main.ts')))
      return candidate
  }
  throw new Error(`cannot locate the desktop main process templates near ${here}`)
}

/** Resolve the main process entry: a project-relative custom entry or the template. */
export function resolveMainEntry(root: string, mainEntry: string | undefined): string {
  return mainEntry ? join(root, mainEntry) : join(getTemplateDir(), 'main.ts')
}
