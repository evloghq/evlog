import { queryCollection } from '@nuxt/content/server'
import { collectSitemapUrls } from '../../utils/sitemap'

/**
 * Feeds `@nuxtjs/sitemap`, which Docus registers and which owns `/sitemap.xml`.
 *
 * This file shadows Docus's source of the same path (`docus/server/api/__sitemap__/urls.ts`,
 * listed in its `sitemap.sources`). Theirs reads `lastmod` from a `modifiedAt` frontmatter
 * key that no page here sets, and queries a `landing` collection this app does not register,
 * so the home page dropped out. Ours dates each page from its last commit and lists the home
 * page at `/`. A route at `server/routes/sitemap.xml.ts` does not work: the module's own
 * handler wins and serves the sitemap without any `lastmod`.
 */
export default defineSitemapEventHandler(async (event) => {
  const { contentCommitDates } = useRuntimeConfig(event)
  return collectSitemapUrls(await queryCollection(event, 'docs').all(), contentCommitDates)
})
