import { createComarkSource } from '#agent-discovery/comark'

/**
 * Content adapter behind nuxt-agent-discovery: the raw markdown route, `sitemap.md`, the `llms.txt`
 * bridge and the MCP helpers all read production content through it. Versioned previews (`/tree`,
 * `/blob`, `/pr`) are excluded from negotiation in nuxt.config.ts and keep serving HTML.
 */
export default createComarkSource(() => getProdContent())
