/**
 * Whether a page can be reached, and whether its description survives a search
 * result.
 *
 * Both are corpus-level: a page is only orphaned relative to every other page,
 * and a description is only a duplicate next to its neighbours. Neither can be
 * decided by reading one file, which is why they live here rather than in
 * `score.mjs`.
 */

const CONTENT_ROOT = 'apps/docs/content'

/** Google truncates around here. Past it, the tail of the sentence is never read. */
export const MAX_DESCRIPTION = 160
/** Under this, the slot is paid for and half used. */
export const MIN_DESCRIPTION = 50

/**
 * The route a content file serves, matching the rules in `loadRoutes`.
 *
 * @param {string} path Repo-relative path.
 * @returns {string | null} Null for anything that is not a docs page.
 */
export function routeOf(path) {
  if (!path.startsWith(`${CONTENT_ROOT}/`)) return null

  const segments = path
    .slice(CONTENT_ROOT.length + 1)
    .split('/')
    .map(segment => segment.replace(/\.md$/, '').replace(/^\d+\./, ''))

  const last = segments.at(-1)
  if (last === 'landing') return null
  if (last === 'index' || last === 'overview') segments.pop()
  return `/${segments.join('/')}`.replace(/\/$/, '') || '/'
}

/**
 * Punctuation the renderer drops before it joins the words with dashes. It is
 * removed rather than collapsed, which is why `Drain & Enrichers` anchors as
 * `drain--enrichers` and `The ratchet: --baseline` as `the-ratchet---baseline`.
 */
const NOT_IN_A_SLUG = /[`*~[\]()!"'#$%^&+=,.:;?<>{}|\\/@]/g

/**
 * The fragment a heading answers to.
 *
 * @param {string} heading Raw heading text, symbols and all.
 * @returns {string}
 */
export function slugOf(heading) {
  return heading.trim().toLowerCase().replace(NOT_IN_A_SLUG, '').replace(/\s/g, '-')
}

/**
 * Findings that only exist when the whole corpus is in view.
 *
 * A page nobody links to in prose is a page the docs never suggest. The nav can
 * still reach it, so this is not a broken link: it is `D-08` unmet, and the
 * voice's own promise that the docs point at the next move rather than waiting
 * to be searched. Section indexes are exempt, and a page linking to itself
 * suggests nothing.
 *
 * @param {{ path: string, links?: { href: string }[], frontmatter?: Record<string, string> }[]} pages
 * @returns {Map<string, { id: string, severity: 'standard', line: number, message: string }[]>}
 */
export function corpusFindings(pages) {
  // Keyed by destination, valued by the pages that point there. A page linking
  // to its own route does not suggest itself to anyone.
  const linked = new Map()
  for (const page of pages) {
    for (const link of page.links ?? []) {
      if (!link.href?.startsWith('/')) continue
      const destination = link.href.split(/[#?]/)[0].replace(/\/$/, '')
      if (!linked.has(destination)) linked.set(destination, new Set())
      linked.get(destination).add(page.path)
    }
  }

  const findings = new Map()
  const add = (path, finding) => {
    if (!findings.has(path)) findings.set(path, [])
    findings.get(path).push(finding)
  }

  // Every fragment the corpus offers, so a link can be checked against the page
  // it points at rather than only against its own.
  const anchors = new Map()
  for (const page of pages) {
    const route = routeOf(page.path)
    if (route !== null) anchors.set(route, new Set((page.headings ?? []).map(heading => slugOf(heading.raw))))
  }

  for (const page of pages) {
    const route = routeOf(page.path)

    // A renamed heading takes its anchor with it, and the link that pointed at
    // the old one now lands at the top of the page with no error anywhere.
    for (const link of page.links ?? []) {
      const [target, fragment] = (link.href ?? '').split('#')
      if (!fragment || (target && !target.startsWith('/'))) continue
      const destination = target ? target.replace(/\/$/, '') : route
      const known = anchors.get(destination)
      if (!known || known.has(fragment)) continue
      add(page.path, {
        id: 'D-12',
        severity: 'critical',
        line: link.line,
        message: `no heading on ${destination} anchors as #${fragment}`,
      })
    }

    // Only a page that serves a route has a search result to fill. A skill's
    // `description` is a routing decision for an agent (`M-06`) and is long on
    // purpose.
    const description = route === null ? undefined : page.frontmatter?.description
    if (description !== undefined) {
      if (description.length > MAX_DESCRIPTION) {
        add(page.path, {
          id: 'D-02',
          severity: 'standard',
          line: 0,
          message: `description is ${description.length} characters; a search result shows about ${MAX_DESCRIPTION}`,
        })
      } else if (description.length < MIN_DESCRIPTION) {
        add(page.path, {
          id: 'D-02',
          severity: 'standard',
          line: 0,
          message: `description is ${description.length} characters, and the slot holds ${MAX_DESCRIPTION}`,
        })
      }
    }

    // A section index is reached through the navigation by design, so nothing
    // in prose is expected to point at it.
    const isIndex = /\/(?:\d+\.)?(index|overview)\.md$/.test(page.path)
    const suggestedBy = [...(linked.get(route) ?? [])].filter(source => source !== page.path)
    if (route !== null && route !== '/' && !isIndex && suggestedBy.length === 0) {
      add(page.path, {
        id: 'D-11',
        severity: 'standard',
        // A page cannot fix this alone: another page has to link to it. The
        // ratchet drops it for that reason.
        corpus: true,
        line: 0,
        message: `no page links to ${route} in prose; the nav can reach it, the docs never suggest it`,
      })
    }
  }

  return findings
}
