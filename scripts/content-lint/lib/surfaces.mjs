/**
 * The corpus, and what each surface is judged on.
 *
 * evlog writes for two audiences. Docs pages, the landing, the blog, and the
 * READMEs are read by people, and how they read is the point. Skills and the
 * AGENTS.md files are read by agents that will act on them, so rhythm carries
 * nothing there: a uniform sentence length in a procedure is a procedure. Both
 * still answer to the house rules and to drift, and drift matters more on the
 * machine-facing half, because an agent acts on a phantom API instead of
 * squinting at it.
 */

import { readdirSync, realpathSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './drift.mjs'

/**
 * `phraseBudget` is summed tell weight, not a hit count. `rhythm` turns the
 * prose-shape checks (T-03, T-06, T-07, T-11, T-12, T-14) on and off as a set.
 * The landing and the reference pages hold the tightest phrase budget for
 * opposite reasons: one sells, the other states.
 */
const PROFILES = {
  landing: { phraseBudget: 2, epigramRatio: 0.6, uniformity: false, rhythm: true },
  reference: { phraseBudget: 2, epigramRatio: 0.25, uniformity: false, rhythm: true },
  blog: { phraseBudget: 3, epigramRatio: 0.3, uniformity: true, rhythm: true },
  docs: { phraseBudget: 3, epigramRatio: 0.35, uniformity: true, rhythm: true },
  readme: { phraseBudget: 2, epigramRatio: 0.4, uniformity: false, rhythm: true },
  skill: { phraseBudget: 4, epigramRatio: 1, uniformity: false, rhythm: false },
  agents: { phraseBudget: 4, epigramRatio: 1, uniformity: false, rhythm: false },
}

/** Every surface, for validating what a caller asks to be judged as. */
export const SURFACES = Object.keys(PROFILES)

/** Trees scanned whole. */
const TREES = ['apps/docs/content', 'skills', '.agents/skills']

/**
 * The doctrine's own reference files quote the prose they ban, worked pair by
 * worked pair. Scanning them measures the examples and ranks the corpus by how
 * well the tell corpus does its job.
 */
const EXCLUDED = /^\.agents\/skills\/write-evlog-content\/references\//

/**
 * @param {string} path Repo-relative path.
 * @returns {keyof typeof PROFILES}
 */
export function surfaceOf(path) {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.endsWith('0.landing.md')) return 'landing'
  if (normalized.includes('/blog/')) return 'blog'
  if (normalized.startsWith('apps/docs/content/')) {
    return /\/(8\.reference|4\.integrate)\//.test(normalized) ? 'reference' : 'docs'
  }
  if (normalized.endsWith('AGENTS.md')) return 'agents'
  if (normalized.startsWith('.agents/skills/') || normalized.startsWith('skills/')) return 'skill'
  if (normalized === 'README.md' || /^(packages|apps)\/[^/]+\/README\.md$/.test(normalized)) return 'readme'
  return 'docs'
}

/**
 * @param {string} surface
 * @returns {typeof PROFILES[keyof typeof PROFILES]}
 */
export function profileOf(surface) {
  return PROFILES[surface] ?? PROFILES.docs
}

/**
 * Every file a content pass may open, repo-relative.
 *
 * Two absences are deliberate. Evi's own skills under `apps/evi/agent/skills`
 * are the agent's operating instructions, and an unattended pass that can
 * rewrite the instructions it just followed has no floor. The playground
 * READMEs under `apps/` are scaffolding nobody arrives at; only the package
 * READMEs ship to npm.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function corpusFiles(repoRoot) {
  const markdown = name => name.endsWith('.md')
  const found = [
    ...TREES.flatMap(tree => walk(join(repoRoot, tree), markdown)),
    ...leaves(repoRoot, 'packages', 'README.md'),
    ...leaves(repoRoot, 'packages', 'AGENTS.md'),
    ...leaves(repoRoot, 'apps', 'AGENTS.md'),
    ...present([join(repoRoot, 'AGENTS.md')]),
  ]

  // The root README is a symlink onto the package one. Scanning both would
  // report every finding twice and rank the same page against itself.
  const byIdentity = new Map(found.map(file => [realpath(file), file]))
  return [...byIdentity.values()]
    .map(file => relative(repoRoot, file))
    .filter(file => !EXCLUDED.test(file))
    .sort()
}

/**
 * Where a symlink points, or the path itself when it dangles. A broken link is
 * its own file for deduplication, and the read that follows reports it.
 *
 * @param {string} file
 * @returns {string}
 */
function realpath(file) {
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

/**
 * @param {string} repoRoot
 * @param {string} group
 * @param {string} name
 * @returns {string[]}
 */
function leaves(repoRoot, group, name) {
  const root = join(repoRoot, group)
  if (!exists(root)) return []
  return present(readdirSync(root).map(entry => join(root, entry, name)))
}

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
function present(paths) {
  return paths.filter(path => exists(path))
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function exists(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}
