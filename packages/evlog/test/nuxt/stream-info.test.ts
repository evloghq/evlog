import { createApp, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import streamInfo from '../../src/runtime/server/routes/_evlog/stream-info.get'

const app = createApp()
app.use('/api/_evlog/stream-info', streamInfo)
const handler = toWebHandler(app)

function get(origin?: string) {
  return handler(new Request('http://localhost:3000/api/_evlog/stream-info', {
    headers: origin ? { origin } : {},
  }))
}

describe('stream-info discovery route', () => {
  it('lets a loopback origin on another port read the stream URL', async () => {
    const res = await get('http://localhost:3001')
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001')
    expect(await res.json()).toHaveProperty('url')
  })

  it('does not let other sites read the stream URL', async () => {
    for (const origin of ['https://evil.com', 'https://localhost.evil.com']) {
      const res = await get(origin)
      expect(res.headers.get('access-control-allow-origin'), origin).toBeNull()
    }
  })
})
