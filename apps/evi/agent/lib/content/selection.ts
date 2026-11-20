import { shellQuote } from './scan'

/**
 * Which pages the next content pass works on. State is derived, never stored:
 * the scanner recomputes every score and git says what was touched, so a
 * dead pass or a dropped branch cannot leave a ledger claiming progress.
 */

export interface LintFinding {
  id: string
  severity: 'critical' | 'standard'
  line: number
  message: string
  excerpt?: string
}

export interface LintPage {
  path: string
  surface: string
  score: number
  findings: LintFinding[]
  /** What no threshold reached on this page. Passed through to the reviewer untouched. */
  modelChecks?: { id: string, ask: string }[]
}

/**
 * `rewrite` pages get an edit in the pass. `report` pages get findings only.
 *
 * Two things earn `report`. The landing page encodes brand decisions no
 * reviewer can read, so only a critical finding moves it. Skills and AGENTS.md
 * files govern the agent running the pass, so it may fix a house rule there and
 * nothing else: `M-09`.
 */
export interface Target extends LintPage {
  mode: 'rewrite' | 'report'
  criticals: number
}

export interface Selection {
  targets: Target[]
  group: string | null
  /** Files the scanner found something on, before the cooldown and the group filter. */
  candidates: number
  /** Files that ranked and were eligible: not in cooldown. Zero is the only reason to skip the rewrite half. */
  eligible: number
  /** Pages that ranked but were held back, with the reason, so a pass can say what it skipped. */
  held: { path: string, reason: string }[]
}

const CONTENT_ROOT = 'apps/docs/content'
const DEFAULT_LIMIT = 5

/** Findings a pass may fix on a file an agent reads. Everything else goes back as a proposal. */
const HOUSE_RULES = new Set(['U-14', 'U-15', 'U-16', 'T-13', 'T-15'])

/** The surfaces where the pass proposes rather than edits. */
const GOVERNED = new Set(['skill', 'agents'])

/**
 * The group a page belongs to, used to keep a pass's diff in one place. A docs
 * section, one skill's directory, or the surface itself where the files do not
 * nest.
 */
export function groupOf(page: Pick<LintPage, 'path' | 'surface'>): string {
  if (page.path.startsWith(`${CONTENT_ROOT}/`)) {
    const first = page.path.slice(CONTENT_ROOT.length + 1).split('/')[0] ?? ''
    return first.endsWith('.md') ? page.surface : first
  }
  if (page.surface === 'skill') {
    const segments = page.path.split('/')
    return segments.slice(0, segments.indexOf('skills') + 2).join('/')
  }
  return page.surface
}

function criticalCount(page: LintPage): number {
  return page.findings.filter(finding => finding.severity === 'critical').length
}

function modeOf(page: LintPage, criticals: number): Target['mode'] {
  if (page.surface === 'landing') return criticals === 0 ? 'report' : 'rewrite'
  if (GOVERNED.has(page.surface)) {
    return page.findings.every(finding => HOUSE_RULES.has(finding.id)) ? 'rewrite' : 'report'
  }
  return 'rewrite'
}

/**
 * Rank the scanned corpus and take the pages this pass should open: critical
 * findings first, low scores second, and pages touched inside the cooldown
 * held — rewriting the same page two days running is churn.
 */
export function selectTargets(input: {
  pages: LintPage[]
  recentlyTouched: string[]
  limit?: number
}): Selection {
  const limit = input.limit ?? DEFAULT_LIMIT
  const touched = new Set(input.recentlyTouched)
  const held: Selection['held'] = []
  const ranked: Target[] = []
  let candidates = 0

  for (const page of input.pages) {
    if (page.findings.length === 0) continue
    candidates += 1
    if (touched.has(page.path)) {
      held.push({ path: page.path, reason: 'changed inside the cooldown window' })
      continue
    }
    const criticals = criticalCount(page)
    ranked.push({ ...page, criticals, mode: modeOf(page, criticals) })
  }

  ranked.sort((a, b) => b.criticals - a.criticals || a.score - b.score || a.path.localeCompare(b.path))

  const counts = { candidates, eligible: ranked.length }

  const [lead] = ranked
  if (lead === undefined) return { targets: [], group: null, held, ...counts }

  const group = groupOf(lead)
  const targets = [lead]

  for (const page of ranked.slice(1)) {
    if (targets.length >= limit) break
    if (groupOf(page) !== group) {
      held.push({ path: page.path, reason: `outside this pass's group (${group})` })
      continue
    }
    targets.push(page)
  }

  return { targets, group, held, ...counts }
}

/**
 * The log that says which files are resting. `--min-parents=1` is
 * load-bearing: in a shallow clone the boundary commit has no recorded
 * parent, so without it `--name-only` lists every file in the repository and
 * the cooldown holds the whole corpus.
 */
export function cooldownCommand(repoDir: string, days: number): string {
  return `git -C ${shellQuote(repoDir)} log --since='${days} days ago' --min-parents=1 --name-only --pretty=format:`
}

/**
 * Paths from `git log --name-only --pretty=format:`, deduplicated. Anything
 * the log reports as touched is off the table for the cooldown, whoever
 * touched it. A page a maintainer edited yesterday does not want a rewrite today.
 */
export function touchedPaths(gitLogOutput: string): string[] {
  const paths = gitLogOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.endsWith('.md'))

  return [...new Set(paths)]
}
