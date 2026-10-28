import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { waitUntilReady } from '../src/orchestrate/probe'

const servers: Server[] = []

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolvePromise => server.close(() => resolvePromise()))))
})

async function listen(): Promise<string> {
  const server = createServer((_request, response) => {
    response.end('ok')
  })
  servers.push(server)
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function freeUrl(): Promise<string> {
  const url = await listen()
  const server = servers.pop()!
  await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
  return url
}

describe('waitUntilReady', () => {
  it('resolves once the URL responds', async () => {
    const url = await listen()
    await expect(waitUntilReady(url, { timeout: 3000, interval: 50 })).resolves.toBeUndefined()
  })

  it('rejects with a DesktopError on timeout', async () => {
    const url = await freeUrl()
    await expect(waitUntilReady(url, { timeout: 300, interval: 50 })).rejects.toThrow(
      'dev server did not become reachable',
    )
  })
})
