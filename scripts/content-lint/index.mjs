#!/usr/bin/env node
/**
 * content-lint: deterministic evidence for an evlog content review.
 *
 * Usage:
 *   node scripts/content-lint                              rank every written surface
 *   node scripts/content-lint apps/docs/content            rank a tree
 *   node scripts/content-lint --top 10                     the worst pages only
 *   node scripts/content-lint <file> --json                one page, machine-readable
 *   node scripts/content-lint --surface skill --top 5      one surface only
 *   node scripts/content-lint --min-score 70               exit 1 below the bar
 *   node scripts/content-lint --since origin/main          exit 1 if a changed file got worse
 *   node scripts/content-lint --url https://…              a page that is not in the repo
 *   cat draft.md | node scripts/content-lint --stdin       prose that is not a file yet
 *
 * The corpus is the docs trees, the landing, the package READMEs, the skills,
 * and the AGENTS.md files. It is defined in `lib/surfaces.mjs`, not here.
 *
 * Nothing this prints is a decision. Every finding carries the id of a rule or
 * tell in `.agents/skills/write-evlog-content/`, and that entry holds the
 * legitimate twin the reviewer weighs it against. `modelChecks` is the other
 * half: what no threshold reached on this page, which the reviewer owes.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarkdown } from './lib/mdc.mjs'
import { measure } from './lib/metrics.mjs'
import { checkDrift, loadApiSurface, loadRoutes, walk } from './lib/drift.mjs'
import { buildBaseline, evaluate } from './lib/score.mjs'
import { SURFACES, corpusFiles, surfaceOf } from './lib/surfaces.mjs'
import { corpusChecks, modelChecks } from './lib/model-checks.mjs'
import { corpusFindings } from './lib/reach.mjs'
import { compare, render } from './lib/ratchet.mjs'
import { extract } from './lib/extract.mjs'
import { fetchPublic } from './lib/net.mjs'
import { applyFixes, isSafeFix, loadRedirects } from './lib/fix.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CONTENT_ROOT = resolve(REPO_ROOT, 'apps/docs/content')

const FETCH_TIMEOUT_MS = 15_000
const MAX_FETCH_BYTES = 4 * 1024 * 1024
/** Below this, extraction found chrome and no article, whatever the page looked like in a browser. */
const MIN_EXTRACTED_CHARS = 200

const argv = process.argv.slice(2)
const options = {
  json: argv.includes('--json'),
  stdin: argv.includes('--stdin'),
  fix: argv.includes('--fix'),
  dryRun: argv.includes('--dry-run'),
  top: numberFlag('--top', { min: 1, integer: true }),
  minScore: numberFlag('--min-score', { min: 0, max: 100 }),
  since: stringFlag('--since'),
  surface: surfaceFlag('--surface'),
  url: stringFlag('--url'),
  as: surfaceFlag('--as') ?? 'docs',
  targets: argv.filter(arg => !arg.startsWith('--') && !isFlagValue(arg)),
}

if (options.url !== null && options.stdin) fail('--url and --stdin read different inputs; pass one.')
if (options.url !== null && !/^https?:\/\//i.test(options.url)) {
  fail('--url takes an http or https address.')
}
if (options.fix && (options.url !== null || options.stdin)) fail('--fix writes files, so it takes paths.')
// A corpus-wide rewrite is a maintainer's decision, not a default.
if (options.fix && options.targets.length === 0) fail('--fix needs the files to fix. It never sweeps the corpus on its own.')
if (options.dryRun && !options.fix) fail('--dry-run belongs with --fix.')

const REDIRECTS_FILE = resolve(REPO_ROOT, 'apps/docs/config/redirects.ts')
const api = loadApiSurface(REPO_ROOT)
const routes = loadRoutes(CONTENT_ROOT, REDIRECTS_FILE)
const redirects = loadRedirects(REDIRECTS_FILE)

// A docs page links by route, a skill links by path. Only the second can be
// resolved on disk, and resolving a route there would report every link.
const LINKS_BY_PATH = new Set(['skill', 'agents', 'readme'])

const scan = (file) => {
  const path = relative(REPO_ROOT, file)
  return {
    path,
    surface: surfaceOf(path),
    ...scanSource(readFileSync(file, 'utf8'), LINKS_BY_PATH.has(surfaceOf(path)) ? file : undefined),
  }
}

/**
 * @param {string} source Markdown.
 * @param {string} [file] Absolute path, when the source is a file on disk.
 */
function scanSource(source, file) {
  const doc = parseMarkdown(source)
  return { frontmatter: doc.frontmatter, links: doc.links, headings: doc.headings, metrics: measure(doc), drift: checkDrift(doc, api, routes, file) }
}

// Ad-hoc input is scanned against the corpus baseline but belongs to no file,
// so it carries no drift check that needs a path and takes its surface from
// `--as`. The rest of the pipeline is the one that runs on a docs page.
const loose = options.url
  ? await fromUrl(options.url)
  : options.stdin
    ? { path: '<stdin>', surface: options.as, ...scanSource(await readStdin()) }
    : null

const corpusRelative = corpusFiles(REPO_ROOT)
const corpusPaths = new Set(corpusRelative)
const corpus = corpusRelative.map(file => join(REPO_ROOT, file))

const files = loose || options.targets.length > 0
  ? options.targets.flatMap((target) => {
      const path = resolve(REPO_ROOT, target)
      if (!path.startsWith(`${REPO_ROOT}/`)) fail(`${target} is outside the repository.`)
      if (!existsSync(path)) fail(`${target} does not exist.`)
      return statSync(path).isDirectory() ? walk(path, name => name.endsWith('.md')) : [path]
    })
  : corpus

if (files.length === 0 && loose === null) fail('no markdown files matched')

// The baseline is the corpus, never the selection: a single-page run has to
// return the same verdict it would inside a full sweep. Reuse the scan already
// done only when the selection *is* the corpus, by identity. A count would let
// a repeated path or an unrelated directory of the right size redefine the
// house rhythm, which is the one number a page cannot argue with. Built at most
// once, since --fix needs it before the reported scan happens.
let corpusRates = null
const corpusBaseline = () => (corpusRates ??= buildBaseline(corpus.map(file => scan(file))))

// Only the corpus is rewritable. A path argument can reach a generated file
// (a CHANGELOG, a lockfile's neighbour) that no rule was written for, and a
// codemod editing generated output is a diff nobody can explain.
const rewritable = new Set(corpus)
const fixes = options.fix ? files.filter(file => rewritable.has(file)).map(fixFile) : []
if (options.fix && fixes.length === 0 && files.length > 0) {
  fail('none of those paths are in the content corpus; see lib/surfaces.mjs')
}

const scanned = [...files.map(scan), ...(loose ? [loose] : [])]

const baseline = corpusRates ?? (isSameSet(files, corpus) ? buildBaseline(scanned) : corpusBaseline())
// Reach and description length only exist against the whole corpus, so they
// are decided here and folded into each page's findings.
const corpus_ = corpus.length === scanned.length ? scanned : corpus.map(file => scan(file))
const reach = corpusFindings(corpus_)

const pages = scanned
  .map(page => ({ ...page, ...evaluate(page, baseline) }))
  .map((page) => {
    const extra = reach.get(page.path) ?? []
    if (extra.length === 0) return page
    const findings = [...page.findings, ...extra].sort((a, b) => a.line - b.line)
    return { ...page, findings, score: Math.max(0, page.score - extra.length * 5) }
  })
  .map(page => ({ ...page, modelChecks: modelChecks(page) }))
  .filter(page => options.surface === null || page.surface === options.surface)
  .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))

const selected = options.top ? pages.slice(0, options.top) : pages

if (options.since !== null) {
  const base = options.since
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n')
    .map(line => line.trim())
    .filter(line => corpusPaths.has(line))

  const results = changed.map((path) => {
    const now = pages.find(page => page.path === path)
      ?? { ...evaluate({ path, surface: surfaceOf(path), ...scanSource(readFileSync(join(REPO_ROOT, path), 'utf8')) }, baseline), path }

    let previous = null
    try {
      const source = execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      previous = { ...evaluate({ path, surface: surfaceOf(path), ...scanSource(source) }, baseline), path }
    } catch {
      previous = null
    }

    // The score carries the corpus penalty too, so it is recomputed from what
    // is left rather than reused.
    const own = (scored) => {
      const findings = scored.findings.filter(finding => finding.corpus !== true)
      const penalty = findings.reduce((total, finding) => total + (finding.severity === 'critical' ? 15 : 5), 0)
      return { ...scored, findings, score: Math.max(0, 100 - penalty) }
    }
    return compare(previous === null ? null : own(previous), own(now))
  })

  process.stdout.write(render(results))
  process.exit(results.some(result => result.verdict === 'worse') ? 1 : 0)
}

if (options.json) {
  process.stdout.write(`${JSON.stringify({ baseline, fixed: fixes, corpusChecks: corpusChecks(corpus_), pages: selected }, null, 2)}\n`)
} else if (options.fix) {
  process.stdout.write(renderFixes(fixes))
} else if (selected.length === 1) {
  process.stdout.write(renderPage(selected[0], baseline))
} else {
  process.stdout.write(renderTable(selected, pages.length, baseline))
}

const worst = pages.at(0)
if (options.minScore !== null && worst && worst.score < options.minScore) {
  process.stderr.write(`content-lint: ${worst.path} scored ${worst.score}, below --min-score ${options.minScore}\n`)
  process.exit(1)
}

/**
 * Apply the derivable fixes to one file, then prove they helped.
 *
 * The proof is the point. A rewrite that trades one finding for another, or
 * lowers the score on its way to removing a dash, is reverted and reported as
 * unfixed. That is what makes this safe to run before a reviewer ever sees the
 * file, and it costs one extra scan.
 *
 * @param {string} file Absolute path.
 */
function fixFile(file) {
  const path = relative(REPO_ROOT, file)
  const before = readFileSync(file, 'utf8')
  const { source, applied } = applyFixes(before, { redirects })

  if (applied.length === 0) return { path, applied: [], written: false }

  const rate = text => evaluate({ path, surface: surfaceOf(path), ...scanSource(text) }, corpusBaseline())
  const was = rate(before)
  const now = rate(source)
  const verdict = isSafeFix(was, now)

  if (!verdict.safe) return { path, applied: [], written: false, reverted: verdict.why }

  if (!options.dryRun) writeFileSync(file, source)
  return { path, applied, written: !options.dryRun, score: { before: was.score, after: now.score } }
}

/**
 * Fetch a page and scan its main content.
 *
 * Extraction is a heuristic and says so: nav, header, footer, and aside are
 * dropped, `<main>` wins over `<article>` wins over the body. A page that
 * renders its prose with script reads as a thin page here, not a clean one.
 *
 * The address comes from a model when the reviewer calls this, so the fetch is
 * bounded on every axis a hostile or merely broken page can stretch: protocol,
 * time, redirects, and bytes.
 *
 * @param {string} url
 */
async function fromUrl(url) {
  const fetched = await fetchPublic(url, { timeoutMs: FETCH_TIMEOUT_MS, userAgent: 'evlog-content-lint' })
  if ('error' in fetched) fail(fetched.error)

  const { response } = fetched
  if (!response.ok) fail(`${url} responded ${response.status}`)
  if (!/^text\/(html|markdown|plain)\b/i.test(response.headers.get('content-type') ?? '')) {
    fail(`${url} served ${response.headers.get('content-type') ?? 'no content type'}; expected html, markdown, or plain text`)
  }

  const html = await readCapped(response.body, MAX_FETCH_BYTES, url)
  const { title, markdown } = /<[a-z][^>]*>/i.test(html) ? extract(html) : { title: null, markdown: html }
  if (markdown.length < MIN_EXTRACTED_CHARS) {
    fail(`${url} yielded ${markdown.length} characters of prose; the page is probably script-rendered`)
  }

  const doc = parseMarkdown(markdown)
  return { path: url, surface: options.as, external: true, title, metrics: measure(doc), drift: [] }
}

/**
 * Read a stream up to a byte ceiling, failing rather than truncating: half a
 * page scanned silently is a score that means nothing.
 *
 * @param {ReadableStream<Uint8Array> | null} stream
 * @param {number} limit
 * @param {string} what
 * @returns {Promise<string>}
 */
async function readCapped(stream, limit, what) {
  if (stream === null) return ''
  const chunks = []
  let size = 0

  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) fail(`${what} is over the ${Math.round(limit / 1024)} KB scan limit`)
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
}

/**
 * @returns {Promise<string>}
 */
function readStdin() {
  return readCapped(process.stdin, MAX_FETCH_BYTES, 'stdin')
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function isSameSet(a, b) {
  const left = new Set(a)
  return left.size === new Set(b).size && b.every(item => left.has(item))
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`content-lint: ${message}\n`)
  process.exit(2)
}

/**
 * @param {object[]} results
 * @returns {string}
 */
function renderFixes(results) {
  const changed = results.filter(result => result.applied.length > 0)
  const reverted = results.filter(result => result.reverted)
  const lines = [
    `content-lint --fix · ${results.length} file${results.length === 1 ? '' : 's'} · ${changed.length} changed${options.dryRun ? ' (dry run, nothing written)' : ''}`,
    '',
  ]

  for (const result of changed) {
    lines.push(`  ${result.path}  ${result.score.before} → ${result.score.after}`)
    for (const entry of result.applied) {
      lines.push(`    [${entry.id}] ${result.path}:${entry.line}`)
      lines.push(`      - ${entry.before}`)
      lines.push(`      + ${entry.after}`)
    }
  }

  for (const result of reverted) lines.push(`  ${result.path} reverted: ${result.reverted}`)

  if (changed.length === 0 && reverted.length === 0) lines.push('  nothing derivable to fix')
  lines.push('', '  What is left needs a reader. Run without --fix for the findings.', '')
  return lines.join('\n')
}

/**
 * @param {object} page
 * @param {object} baseline
 * @returns {string}
 */
function renderPage(page, baseline) {
  const metrics = page.metrics
  const lines = [
    `${page.path}`,
    `  surface ${page.surface} · score ${page.score} · ${metrics.words} words · ${metrics.paragraphs} paragraphs · ${metrics.codeBlocks} code blocks`,
    `  dashes ${metrics.dashes.count} · epigram ratio ${metrics.epigrams.ratio} (corpus median ${baseline.epigramRatio}) · sentence CV ${metrics.sentenceLengthCv} · contractions ${metrics.contractionRatio ?? 'n/a'}`,
    '',
  ]

  if (page.findings.length === 0) {
    lines.push('  no candidates')
  } else {
    for (const finding of page.findings) {
      const where = finding.line ? `:${finding.line}` : ''
      lines.push(`  [${finding.id}] ${finding.severity === 'critical' ? 'critical' : 'standard'} ${page.path}${where}`)
      lines.push(`      ${finding.message}`)
      if (finding.excerpt) lines.push(`      "${finding.excerpt}"`)
    }
  }

  lines.push('', '  Nothing above is decided. Judge each one against its twin in .agents/skills/write-evlog-content/references/ai-tells.md')

  lines.push('', '  What this scan could not measure. Answer these by reading:')
  for (const check of page.modelChecks) lines.push(`  [${check.id}] ${check.ask}`)

  return `${lines.join('\n')}\n`
}

/**
 * @param {object[]} selected
 * @param {number} total
 * @param {object} baseline
 * @returns {string}
 */
function renderTable(selected, total, baseline) {
  const width = Math.max(...selected.map(page => page.path.length))
  const rows = selected.map((page) => {
    const critical = page.findings.filter(finding => finding.severity === 'critical').length
    const ids = [...new Set(page.findings.map(finding => finding.id))].join(' ')
    return `  ${String(page.score).padStart(3)}  ${page.path.padEnd(width)}  ${String(critical).padStart(2)}!  ${ids}`
  })

  const surfaces = [...new Set(selected.map(page => page.surface))].sort()

  return [
    `content-lint · ${total} pages · ${surfaces.join(', ')} · corpus median epigram ratio ${baseline.epigramRatio}`,
    '',
    `  score  ${'page'.padEnd(width)}  crit  candidates`,
    ...rows,
    '',
    `  ${selected.length} shown, worst first. Run a single page for its findings.`,
    '',
  ].join('\n')
}

/**
 * @param {string} name
 * @returns {number | null}
 */
function numberFlag(name, bounds) {
  const at = argv.indexOf(name)
  if (at === -1) return null

  const raw = argv[at + 1]
  const value = Number(raw)
  // A typo used to read as "flag absent", which silently disabled --min-score
  // and made --top 0 mean "every page".
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(value)) {
    fail(`${name} takes a number. Got ${raw === undefined ? 'nothing' : `"${raw}"`}.`)
  }
  if (bounds.integer && !Number.isInteger(value)) fail(`${name} takes a whole number.`)
  if (value < bounds.min || (bounds.max !== undefined && value > bounds.max)) {
    fail(`${name} takes a number between ${bounds.min} and ${bounds.max ?? 'up'}. Got ${value}.`)
  }
  return value
}

/**
 * @param {string} name
 * @returns {string | null}
 */
function stringFlag(name) {
  const at = argv.indexOf(name)
  if (at === -1) return null
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value.`)
  return value
}

/**
 * A surface name, checked against the ones that exist. An unknown value would
 * otherwise fall through to the docs profile and report thresholds nobody asked
 * for.
 *
 * @param {string} name
 * @returns {string | null}
 */
function surfaceFlag(name) {
  const value = stringFlag(name)
  if (value !== null && !SURFACES.includes(value)) {
    fail(`${name} takes one of: ${SURFACES.join(', ')}. Got "${value}".`)
  }
  return value
}

/**
 * @param {string} arg
 * @returns {boolean}
 */
function isFlagValue(arg) {
  const at = argv.indexOf(arg)
  return at > 0 && ['--top', '--min-score', '--surface', '--url', '--as', '--since'].includes(argv[at - 1])
}
