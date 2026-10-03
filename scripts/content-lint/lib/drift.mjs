/**
 * Drift between the docs and the package they document.
 *
 * Three deterministic checks no prose reviewer runs reliably: an import of a
 * symbol or entry point the package no longer exports, a prose symbol that is
 * one rename away from a real export, and an internal link with no page behind
 * it. The first and third are hard findings.
 *
 * Prose symbols are checked by near-miss on purpose. Docs pages legitimately
 * name third-party APIs, so an unknown symbol proves nothing. An unknown
 * symbol two characters from a real export is a rename that missed a page.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const EXPORT_DECLARATION = /export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
// `export type { Foo }` counts: a page importing a type-only re-export would
// otherwise read as importing a symbol the package does not have.
const EXPORT_LIST = /export\s*(?:type\s+)?\{([^}]*)\}/g
const IMPORT_STATEMENT = /import\s+(?:type\s+)?(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]/g
const EVLOG_SPECIFIER = /['"](evlog(?:\/[\w-]+)*|@evlog\/[\w-]+(?:\/[\w-]+)*)['"]/g
const IMPORT_PATH = /^(evlog(\/[\w-]+)*|@evlog\/[\w-]+(\/[\w-]+)*)$/
const API_SYMBOL = /^(define|create|use|with)[A-Z][A-Za-z0-9]*(\(\))?$/
const REDIRECT_KEY = /['"](\/[^'"]*)['"]\s*:\s*r\(/g

/**
 * Every name the packages export, plus every public entry point.
 *
 * @param {string} repoRoot
 * @returns {{ symbols: Set<string>, entries: Set<string> }}
 */
export function loadApiSurface(repoRoot) {
  const symbols = new Set()
  const entries = new Set()

  for (const packageDir of ['packages/evlog', 'packages/cli', 'packages/nuxthub', 'packages/signals', 'packages/telemetry']) {
    const root = join(repoRoot, packageDir)
    if (!exists(root)) continue

    for (const file of walk(join(root, 'src'), name => name.endsWith('.ts') && !name.endsWith('.d.ts'))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(EXPORT_DECLARATION)) symbols.add(match[1])
      for (const match of source.matchAll(EXPORT_LIST)) {
        for (const part of match[1].split(',')) {
          const name = part.split(/\s+as\s+/).at(-1)?.trim()
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) symbols.add(name)
        }
      }
    }

    const manifestPath = join(root, 'package.json')
    if (!exists(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const key of Object.keys(manifest.exports ?? {})) {
      entries.add(key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`)
    }
  }

  return { symbols, entries }
}

/**
 * Every path the docs site serves: content routes, plus the redirects that make
 * an older URL still resolve.
 *
 * @param {string} contentRoot
 * @param {string} [redirectsFile]
 * @returns {Set<string>}
 */
export function loadRoutes(contentRoot, redirectsFile) {
  const routes = new Set(['/'])

  for (const file of walk(contentRoot, name => name.endsWith('.md'))) {
    const segments = relative(contentRoot, file)
      .split(sep)
      .map(segment => segment.replace(/\.md$/, '').replace(/^\d+\./, ''))

    const last = segments.at(-1)
    if (last === 'landing') continue
    if (last === 'index') segments.pop()
    routes.add(`/${segments.join('/')}`)
    // Docus serves an `overview` leaf at its parent path too.
    if (last === 'overview') routes.add(`/${segments.slice(0, -1).join('/')}`)
  }

  if (redirectsFile && exists(redirectsFile)) {
    const source = readFileSync(redirectsFile, 'utf8')
    for (const match of source.matchAll(REDIRECT_KEY)) routes.add(match[1].replace(/\/$/, ''))
  }

  return routes
}

/**
 * @param {import('./mdc.mjs').ParsedDoc} doc
 * @param {{ symbols: Set<string>, entries: Set<string> }} api
 * @param {Set<string>} routes
 * @param {string} [file] Absolute path, needed to resolve relative links on disk.
 * @returns {{ id: string, severity: 'critical' | 'standard', line: number, message: string }[]}
 */
export function checkDrift(doc, api, routes, file) {
  return [
    ...checkImports(doc, api),
    ...checkProseSymbols(doc, api),
    ...checkLinks(doc, routes),
    ...(file ? checkFileLinks(doc, file) : []),
  ]
}

/**
 * @param {import('./mdc.mjs').ParsedDoc} doc
 * @param {{ symbols: Set<string>, entries: Set<string> }} api
 */
function checkImports(doc, api) {
  const findings = []
  const seen = new Set()
  const reportedSpecifiers = new Set()

  const report = (line, message) => {
    if (seen.has(message)) return
    seen.add(message)
    findings.push({ id: 'T-15', severity: 'critical', line, message })
  }

  for (const block of doc.code) {
    for (const match of block.text.matchAll(IMPORT_STATEMENT)) {
      const specifier = match[3]
      if (!IMPORT_PATH.test(specifier)) continue
      if (!api.entries.has(specifier)) {
        reportedSpecifiers.add(specifier)
        report(block.line, `\`${specifier}\` is imported but is not an entry point in package.json#exports`)
        continue
      }
      const named = (match[1] ?? '')
        .split(',')
        .map(part => part.split(/\s+as\s+/)[0].replace(/^\s*type\s+/, '').trim())
        .filter(Boolean)
      for (const name of named) {
        if (!api.symbols.has(name)) {
          report(block.line, `\`${name}\` is imported from \`${specifier}\` but no package source exports it`)
        }
      }
    }

    for (const match of block.text.matchAll(EVLOG_SPECIFIER)) {
      if (!api.entries.has(match[1]) && !reportedSpecifiers.has(match[1])) {
        report(block.line, `\`${match[1]}\` is referenced but is not an entry point in package.json#exports`)
      }
    }
  }

  return findings
}

/**
 * @param {import('./mdc.mjs').ParsedDoc} doc
 * @param {{ symbols: Set<string>, entries: Set<string> }} api
 */
function checkProseSymbols(doc, api) {
  const findings = []
  const seen = new Set()

  for (const { token, line } of doc.inlineCode) {
    const name = token.trim().replace(/\(\)$/, '')
    if (!API_SYMBOL.test(name) || api.symbols.has(name) || seen.has(name)) continue
    const near = nearest(name, api.symbols)
    if (!near) continue
    seen.add(name)
    findings.push({
      id: 'T-15',
      severity: 'standard',
      line,
      message: `\`${name}\` is not exported; the closest export is \`${near}\``,
    })
  }

  return findings
}

/**
 * @param {import('./mdc.mjs').ParsedDoc} doc
 * @param {Set<string>} routes
 */
function checkLinks(doc, routes) {
  const findings = []

  for (const link of doc.links) {
    if (!link.href.startsWith('/')) continue
    const path = link.href.split(/[#?]/)[0].replace(/\/$/, '')
    if (path === '' || routes.has(path)) continue
    findings.push({
      id: 'U-16',
      severity: 'critical',
      line: link.line,
      message: `link to ${link.href} has no page and no redirect`,
    })
  }

  return findings
}

/**
 * Relative links, resolved on disk. Passed a file only for the surfaces where a
 * link is a path rather than a route: the skills and the AGENTS.md files, whose
 * cross-references rot every time something moves.
 *
 * @param {import('./mdc.mjs').ParsedDoc} doc
 * @param {string} file Absolute path of the file being scanned.
 */
function checkFileLinks(doc, file) {
  const findings = []
  const base = dirname(file)

  for (const link of doc.links) {
    if (/^([a-z]+:|\/|#)/i.test(link.href)) continue
    const target = join(base, link.href.split('#')[0])
    if (exists(target)) continue
    findings.push({
      id: 'U-16',
      severity: 'critical',
      line: link.line,
      message: `link to ${link.href} resolves to nothing on disk`,
    })
  }

  return findings
}

/**
 * The closest export within two edits, or null when the symbol belongs to
 * something else entirely.
 *
 * @param {string} name
 * @param {Set<string>} symbols
 * @returns {string | null}
 */
function nearest(name, symbols) {
  let best = null
  let bestDistance = 3

  for (const candidate of symbols) {
    if (Math.abs(candidate.length - name.length) >= bestDistance) continue
    const distance = editDistance(name, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  return best
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index)

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }

  return previous[b.length]
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} accept
 * @returns {string[]}
 */
export function walk(dir, accept) {
  if (!exists(dir)) return []
  const found = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...walk(path, accept))
    else if (accept(entry)) found.push(path)
  }
  return found
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
