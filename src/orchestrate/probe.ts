import { DesktopError } from '../error'

export interface ProbeOptions {
  timeout?: number
  interval?: number
  onWaiting?: () => void
}

/** Any HTTP response (including 4xx/5xx) means the server is up. */
async function isUrlReady(url: string): Promise<boolean> {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
    return true
  }
  catch {
    return false
  }
}

export async function waitUntilReady(url: string, options: ProbeOptions = {}): Promise<void> {
  const timeout = options.timeout ?? 60_000
  const interval = options.interval ?? 500
  const deadline = Date.now() + timeout
  let announced = false

  for (;;) {
    if (await isUrlReady(url))
      return
    if (Date.now() > deadline) {
      throw new DesktopError(
        `dev server did not become reachable at ${url} within ${timeout}ms. `
        + `Check the \`desktop.dev.url\` option in unh.config.ts or start the H5 dev server on that URL.`,
      )
    }
    if (!announced) {
      announced = true
      options.onWaiting?.()
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, interval))
  }
}
