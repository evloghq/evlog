import type { RequestListener } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createHttpDrain } from '../src/drain'
import { exampleRunEvent } from '../src/disclosure'
import { closeServers, ingest, listen } from './helpers/server'

function answer(status: number): RequestListener {
  return (request, response) => {
    request.resume()
    response.writeHead(status).end()
  }
}

describe('createHttpDrain', () => {
  afterEach(closeServers)

  it('posts the batch as JSON', async () => {
    const { url, bodies, requests } = await ingest()
    const event = exampleRunEvent()

    await expect(createHttpDrain(url)([event])).resolves.toBe(true)

    expect(requests.map(request => `${request.method} ${request.headers['content-type']}`)).toEqual(['POST application/json'])
    expect(bodies).toEqual([JSON.stringify({ events: [event] })])
  })

  it('drops permanently-rejected batches on 400 instead of retrying forever', async () => {
    // The exact failure mode this guards: a stale/oversized outbox batch
    // that will never become valid by resending the same bytes — without
    // this, it would block all future telemetry for the tool indefinitely.
    const { url } = await listen(answer(400))
    await expect(createHttpDrain(url)([exampleRunEvent()])).resolves.toBe(true)
  })

  it('keeps retrying on 429 (rate limited)', async () => {
    const { url } = await listen(answer(429))
    await expect(createHttpDrain(url)([exampleRunEvent()])).resolves.toBe(false)
  })

  it('keeps retrying on a 5xx server error', async () => {
    const { url } = await listen(answer(500))
    await expect(createHttpDrain(url)([exampleRunEvent()])).resolves.toBe(false)
  })

  it('keeps retrying on a network failure', async () => {
    await expect(createHttpDrain('http://127.0.0.1:1/ingest')([exampleRunEvent()])).resolves.toBe(false)
  })

  it('keeps retrying on an endpoint that is not a URL', async () => {
    await expect(createHttpDrain('not a url')([exampleRunEvent()])).resolves.toBe(false)
  })

  it('gives up on a server that never answers, and closes the connection', async () => {
    const { url, sockets } = await listen(() => {})

    await expect(createHttpDrain(url, 50)([exampleRunEvent()])).resolves.toBe(false)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.destroyed).toBe(true)
  })

  it('short-circuits on an empty batch without a request', async () => {
    const { url, requests } = await ingest()
    await expect(createHttpDrain(url)([])).resolves.toBe(true)
    expect(requests).toHaveLength(0)
  })
})
