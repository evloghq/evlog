/**
 * Turning measurements into ranked candidates.
 *
 * Two kinds of threshold live here. A house rule (no em dash, no assistant
 * framing) fires on the first occurrence, because the decision was already
 * made. A rhythm (short closers, uniform sentences) is judged against the
 * corpus itself, since what counts as elevated depends on how evlog already
 * writes; an absolute floor keeps a uniformly slack corpus from normalising
 * itself.
 */

import { ALTERNATIVES } from './corpus.mjs'
import { profileOf, surfaceOf } from './surfaces.mjs'

// Deprecation vocabulary, not a bare negation: `not` alone let "do not forget
// to import from `evlog/shared`" through, and T-15 is the one critical tell.
const DOCUMENTING_A_DEPRECATION = /\b(deprecat\w*|removed|retired|renamed|legacy|no longer|instead of|prefer|migrat\w*|never use|never import|do(es)? not (use|exist|ship)|not an entry point|no code import)\b/i

/** Below this, a surface cannot speak for itself and answers to the whole-corpus median. */
const MIN_SURFACE_SAMPLE = 5

/**
 * Median rates over the batch, used as the house baseline, plus the same
 * medians per surface. A reference page and a skill file have different
 * natural rhythms, and one median over both flatters whichever is looser.
 *
 * @param {{ path: string, metrics: object }[]} pages
 * @returns {{ sample: number, epigramRatio: number, bySurface: Record<string, { sample: number, epigramRatio: number }> }}
 */
export function buildBaseline(pages) {
  const usable = pages.filter(page => page.metrics.words >= 150)
  const rates = group => ({
    sample: group.length,
    epigramRatio: median(group.map(page => page.metrics.epigrams.ratio)),
  })

  const bySurface = {}
  for (const [surface, group] of groupBy(usable, page => surfaceOf(page.path))) {
    if (group.length >= MIN_SURFACE_SAMPLE) bySurface[surface] = rates(group)
  }

  return { ...rates(usable), bySurface, templates: buildTemplates(pages) }
}

/** Below this, two pages sharing a heading is a coincidence rather than a shape. */
const TEMPLATE_SIBLINGS = 3

/**
 * Headings a directory uses on most of its pages.
 *
 * A page set written to one shape is not a page written from a mould. The
 * adapter pages all carry Installation, Quick Start, Configuration and
 * Troubleshooting on purpose: a reader comparing two of them wants to land on
 * the same section twice. `T-06` is about a single page whose headings all came
 * out of one grammatical stamp, so the shared part is subtracted first.
 *
 * @param {{ path: string, metrics: object }[]} pages
 * @returns {Record<string, Set<string>>}
 */
function buildTemplates(pages) {
  const byDirectory = new Map()
  for (const page of pages) {
    const directory = page.path.split('/').slice(0, -1).join('/')
    if (!byDirectory.has(directory)) byDirectory.set(directory, [])
    byDirectory.get(directory).push(page)
  }

  const templates = {}
  for (const [directory, siblings] of byDirectory) {
    if (siblings.length < TEMPLATE_SIBLINGS) continue
    const seen = new Map()
    for (const page of siblings) {
      for (const text of new Set(page.metrics.headings.texts ?? [])) {
        seen.set(text, (seen.get(text) ?? 0) + 1)
      }
    }
    const shared = [...seen.entries()].filter(([, n]) => n >= TEMPLATE_SIBLINGS).map(([text]) => text)
    if (shared.length > 0) templates[directory] = new Set(shared)
  }
  return templates
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * @param {object} page
 * @param {string} page.path
 * @param {object} page.metrics
 * @param {object[]} page.drift
 * @param {string} [page.surface] Stated by ad-hoc input, which belongs to no path.
 * @param {boolean} [page.external] True for a page outside this repository, which answers to no evlog-specific check.
 * @param {ReturnType<typeof buildBaseline>} baseline
 * @returns {{ surface: string, score: number, findings: object[] }}
 */
export function evaluate(page, baseline) {
  // Ad-hoc input (a URL, a draft on stdin) belongs to no path and states its
  // own surface. Everything in the corpus takes it from where it lives.
  const surface = page.surface ?? surfaceOf(page.path)
  const profile = profileOf(surface)
  const rates = baseline.bySurface?.[surface] ?? baseline
  const metrics = page.metrics
  const findings = [...page.drift]

  if (metrics.dashes.count > 0) {
    findings.push({
      id: 'U-14',
      severity: 'standard',
      line: metrics.dashes.occurrences[0]?.line ?? 0,
      message: `${metrics.dashes.count} em or en dash${metrics.dashes.count === 1 ? '' : 'es'} in prose`,
      excerpt: metrics.dashes.occurrences[0]?.text,
    })
  }

  for (const [id, hits] of groupBy(metrics.phrases, hit => hit.id)) {
    // A page outside this repository is measured on how it reads, never on
    // whether it is true about evlog. Its entry points are someone else's, its
    // links resolve against a site we do not serve, and its vocabulary is the
    // vocabulary of whatever it documents.
    if (id === 'T-15') {
      if (page.external) continue
      for (const hit of hits) {
        // A page that names the retired path to deprecate it is doing its job.
        if (DOCUMENTING_A_DEPRECATION.test(hit.excerpt ?? '')) continue
        findings.push({
          id,
          severity: 'critical',
          line: hit.line,
          message: `retired entry point \`${hit.phrase}\``,
          excerpt: hit.excerpt,
        })
      }
      continue
    }

    if (id === 'T-13') {
      for (const hit of hits) {
        findings.push({ id, severity: 'standard', line: hit.line, message: `assistant framing "${hit.phrase}"`, excerpt: hit.excerpt })
      }
      continue
    }

    const weight = hits.reduce((total, hit) => total + hit.weight, 0)
    if (weight >= profile.phraseBudget) {
      findings.push({
        id,
        severity: 'standard',
        line: hits[0].line,
        message: `${hits.length} hits: ${[...new Set(hits.map(hit => hit.phrase))].slice(0, 5).join(', ')}`,
        excerpt: hits[0].excerpt,
      })
    }
  }

  const offName = page.external ? [] : metrics.offName.filter(hit => !namesAnAlternative(hit.excerpt))
  if (offName.length > 0) {
    findings.push({
      id: 'U-15',
      severity: 'standard',
      line: offName[0].line,
      message: `evlog's own concepts under another name: ${[...new Set(offName.map(hit => `${hit.wrong} for ${hit.canonical}`))].join(', ')}`,
      excerpt: offName[0].excerpt,
    })
  }

  if (metrics.comparisons.length > 0 && !page.external) {
    const tools = [...new Set(metrics.comparisons.map(hit => hit.tool))].join(', ')
    findings.push({
      id: 'U-12',
      severity: 'standard',
      line: metrics.comparisons[0].line,
      message: `${metrics.comparisons.length} claim${metrics.comparisons.length === 1 ? '' : 's'} about ${tools} with no number and no link`,
      excerpt: metrics.comparisons[0].excerpt,
    })
  }

  const template = baseline.templates?.[page.path.split('/').slice(0, -1).join('/')]
  if (profile.rhythm) findings.push(...rhythm(metrics, profile, rates, template))

  const penalty = findings.reduce((total, finding) => total + (finding.severity === 'critical' ? 15 : 5), 0)
  return { surface, score: Math.max(0, 100 - penalty), findings: findings.sort((a, b) => a.line - b.line) }
}

/**
 * How the prose moves. Off on the surfaces an agent reads, where a uniform
 * sentence length is a procedure and a short closer is a step.
 *
 * @param {object} metrics
 * @param {{ epigramRatio: number, uniformity: boolean }} profile
 * @param {{ epigramRatio: number }} rates
 * @param {Set<string>} [template] Headings this page shares with its siblings.
 * @returns {object[]}
 */
function rhythm(metrics, profile, rates, template) {
  const findings = []

  if (metrics.epigrams.eligible >= 6 && metrics.epigrams.ratio > Math.max(profile.epigramRatio, rates.epigramRatio * 1.5)) {
    findings.push({
      id: 'T-03',
      severity: 'standard',
      line: metrics.epigrams.candidates[0]?.line ?? 0,
      message: `${metrics.epigrams.count} of ${metrics.epigrams.eligible} paragraphs close on a short line carrying no fact`,
      excerpt: metrics.epigrams.candidates[0]?.text,
    })
  }

  const own = ownHeadings(metrics.headings, template)
  const enumerates = metrics.headings.enumerationShare >= 0.6
  if (own.count >= 4 && own.share >= 0.9 && !enumerates && own.dominant !== 'symbol' && own.dominant !== 'sequence') {
    findings.push({
      id: 'T-06',
      severity: 'standard',
      line: 0,
      message: `${own.count} of this page's own headings are ${own.dominant}; the rest are its section's shared shape`,
    })
  }

  for (const list of metrics.bulletFrames) {
    // Five, not four. At four items a shared opener is three of them, which is
    // what a decision list, a pitfalls list, or a set of controlled variables
    // looks like when it is doing its job.
    if (list.opening >= 5 && list.anaphoraShare >= 0.75) {
      findings.push({
        id: 'T-07',
        severity: 'standard',
        line: list.line,
        message: `${list.anaphora} of ${list.opening} bullets share one opener; a table in bullet form?`,
      })
    }
  }

  if (metrics.contractionSeam && metrics.contractionSeam.delta >= 0.7 && metrics.contractionOpportunities >= 8) {
    findings.push({
      id: 'T-11',
      severity: 'standard',
      line: metrics.contractionSeam.line,
      message: `contraction density jumps ${metrics.contractionSeam.delta} between adjacent paragraphs`,
    })
  }

  if (profile.uniformity && metrics.sentences >= 15 && metrics.sentenceLengthCv < 0.35) {
    findings.push({
      id: 'T-12',
      severity: 'standard',
      line: 0,
      message: `sentence lengths vary by ${metrics.sentenceLengthCv} across ${metrics.sentences} sentences`,
    })
  }

  for (const section of metrics.unbackedSections) {
    findings.push({
      id: 'T-14',
      severity: 'standard',
      line: section.line,
      message: `"${section.heading}" runs ${section.words} words with no code, link, number, or symbol`,
    })
  }

  return findings
}

/**
 * The headings a page did not inherit from its directory's shape.
 *
 * @param {{ count: number, share: number, texts?: string[] }} headings
 * @param {Set<string>} [template]
 * @returns {{ count: number, share: number }}
 */
function ownHeadings(headings, template) {
  const texts = headings.texts ?? []
  const shapes = headings.shapes ?? []
  if (template === undefined || texts.length === 0) return headings

  const kept = shapes.filter((_shape, index) => !template.has(texts[index]))
  if (kept.length === texts.length) return headings
  if (kept.length === 0) return { count: 0, share: 0, dominant: null }

  const tally = new Map()
  for (const shape of kept) tally.set(shape, (tally.get(shape) ?? 0) + 1)
  const [dominant, top] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  return { count: kept.length, share: top / kept.length, dominant }
}

/**
 * A sentence that names another logger is allowed to use that logger's
 * vocabulary. It is describing it.
 *
 * @param {string} text
 * @returns {boolean}
 */
function namesAnAlternative(text) {
  const lower = text.toLowerCase()
  return ALTERNATIVES.some(name => new RegExp(`\\b${name}\\b`).test(lower))
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} key
 * @returns {Map<string, T[]>}
 */
function groupBy(items, key) {
  const map = new Map()
  for (const item of items) {
    const group = key(item)
    if (!map.has(group)) map.set(group, [])
    map.get(group).push(item)
  }
  return map
}
