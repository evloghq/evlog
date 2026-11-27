import type { DocsContent } from './content'

interface SearchSection {
  id: string
  title: string
  titles: string[]
  level: number
  content: string
}

// Building the index parses every document — the most expensive read in the app. The built sections
// are persisted in `content.cache`, whose driver is namespaced per parser version and content SHA, so
// the index survives cold starts, is shared across lambda instances in the region, and stale parser
// output is unreachable. Colon-free so it can't collide with `<source>:<path>` content keys, the
// `manifest` key, or the shared `gh:` namespace, and the SWR fallback in `cache.get`
// (`key.split(':')`) can't map it to a real source.
const SEARCH_SECTIONS_KEY = 'search-sections'

/**
 * Drop the cached index — the one case the per-SHA namespace can't cover: in dev the default
 * instance watches the working tree, so content changes under a stable ref. Called from
 * `watch:file:update`.
 */
export function invalidateSearchSections(content: DocsContent): void {
  void content.cache.invalidate(SEARCH_SECTIONS_KEY).catch(() => {})
}

/**
 * Keyword-score the search index against `query` and return the best sections.
 */
export async function searchDocSections(content: DocsContent, query: string, limit = 10): Promise<SearchSection[]> {
  const sections = await buildSearchSections(content)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  return sections
    .map((section) => {
      const haystackTitle = [section.title, ...section.titles].join(' ').toLowerCase()
      const haystackContent = section.content.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (haystackTitle.includes(term)) score += 3
        if (haystackContent.includes(term)) score += 1
      }
      return { section, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.section)
}

/** Walk every document's AST, one section per heading — the shape `UContentSearch` takes as `files`. */
export async function buildSearchSections(content: DocsContent): Promise<SearchSection[]> {
  const cached = await content.cache.get<SearchSection[]>(SEARCH_SECTIONS_KEY)
  if (cached) return cached

  const sections = await collectSearchSections(content)
  // Non-fatal: an oversized payload (Runtime Cache per-item limit) just means no persistence.
  await content.cache.set(SEARCH_SECTIONS_KEY, sections).catch(() => {})
  return sections
}

async function collectSearchSections(content: DocsContent): Promise<SearchSection[]> {
  const docs = await content.list()
  const sections: SearchSection[] = []

  // Parsed up front rather than one await per iteration; the walk below is order-dependent.
  const items = await Promise.all(docs.map((meta) => content.get(meta.path)))

  for (const [index, meta] of docs.entries()) {
    const item = items[index]
    if (!item || item.meta.kind !== 'document') continue

    const data = item.data as Record<string, unknown> | undefined
    const title = (data?.title as string) ?? meta.path
    const description = (data?.description as string) ?? ''

    sections.push({ id: item.path, title, titles: [], level: 1, content: description })

    if (!item.nodes?.length) continue

    const titles = [title]
    let previousLevel = 0
    let current = sections[sections.length - 1]!

    for (const node of item.nodes) {
      const tag = getTag(node)
      const level = headingLevel(tag)

      if (level > 0) {
        const sectionTitle = extractText(node).trim()
        if (level === 1) titles.splice(0, titles.length)
        else if (level < previousLevel) titles.splice(level - 1, titles.length - 1)
        else if (level === previousLevel) titles.pop()

        const attrs = getAttrs(node)
        current = {
          id: attrs.id ? `${item.path}#${attrs.id}` : item.path,
          title: sectionTitle,
          titles: [...titles],
          level,
          content: '',
        }
        sections.push(current)
        titles.push(sectionTitle)
        previousLevel = level
      } else {
        const text = extractText(node).trim()
        if (text) current.content = current.content ? `${current.content} ${text}` : text
      }
    }
  }

  return sections
}

function extractText(node: unknown): string {
  if (typeof node === 'string') return node
  if (!Array.isArray(node) || node[0] === null) return ''
  return node.slice(2).map(extractText).filter(Boolean).join('')
}

function getTag(node: unknown): string {
  if (Array.isArray(node) && typeof node[0] === 'string') return node[0]
  return ''
}

function getAttrs(node: unknown): Record<string, unknown> {
  if (Array.isArray(node) && node[1] && typeof node[1] === 'object') {
    return node[1] as Record<string, unknown>
  }
  return {}
}

function headingLevel(tag: string): number {
  const m = tag.match(/^h([1-6])$/)
  return m ? Number(m[1]) : 0
}
