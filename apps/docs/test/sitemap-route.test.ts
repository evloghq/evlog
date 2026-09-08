import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import sitemap from '../server/routes/sitemap.xml'

vi.mock('@nuxt/content/server', () => ({
  queryCollection: () => ({ all: () => Promise.resolve([{ path: '/start/quick-start' }]) }),
}))

afterEach(() => vi.unstubAllGlobals())

describe('sitemap route', () => {
  it.each(['https://docs.example.test', 'https://docs.example.test/'])(
    'uses the configured site URL %s for absolute locations',
    async (url) => {
      vi.stubGlobal('getSiteConfig', () => ({ url }))
      vi.stubGlobal('useRuntimeConfig', () => ({ contentCommitDates: {} }))
      const req = new IncomingMessage(new Socket())
      const res = new ServerResponse(req)
      const xml = await sitemap(createEvent(req, res))

      expect(xml).toContain('<loc>https://docs.example.test/start/quick-start</loc>')
      expect(res.getHeader('content-type')).toBe('application/xml')
    },
  )
})
