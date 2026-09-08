import { defineEventHandler, setResponseHeader } from 'h3'
import { queryCollection } from '@nuxt/content/server'
import { type SitemapUrl, collectSitemapUrls } from '../utils/sitemap'

/**
 * Overrides the default Docus sitemap (`node_modules/docus/server/routes/sitemap.xml.ts`).
 *
 * Two reasons we ship our own:
 * 1. Docus unconditionally queries the `landing` collection. Since this app provides its
 *    own `app/pages/index.vue`, that collection is not registered, so the request to
 *    `/__nuxt_content/landing/query` 404s and Nitro logs it as `[fatal]` during build.
 * 2. The home page lives at `/` but is sourced from `content/0.landing.md` (path
 *    `/landing` in the docs collection). Docus's sitemap therefore lists `/landing`,
 *    pointing at a URL that does not match any prerendered page. We rewrite it to `/`.
 */
export default defineEventHandler(async (event) => {
  const siteUrl = getSiteConfig(event).url

  let urls: SitemapUrl[] = []

  try {
    const { contentCommitDates } = useRuntimeConfig(event)
    urls = collectSitemapUrls(await queryCollection(event, 'docs').all(), contentCommitDates)
  } catch {
    // Collection might not exist, skip silently.
  }

  setResponseHeader(event, 'content-type', 'application/xml')
  return generateSitemap(urls, siteUrl)
})

function generateSitemap(urls: SitemapUrl[], siteUrl: string): string {
  const urlEntries = urls
    .map((url) => {
      const loc = new URL(url.loc, siteUrl).href
      let entry = `  <url>\n    <loc>${escapeXml(loc)}</loc>`
      if (url.lastmod) {
        entry += `\n    <lastmod>${escapeXml(url.lastmod)}</lastmod>`
      }
      entry += `\n  </url>`
      return entry
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
