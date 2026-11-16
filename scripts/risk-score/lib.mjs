/**
 * Pure helpers for `index.mjs`: no network, so they can be tested on fixtures.
 *
 * The assessment reads only the pull request metadata, the file list the
 * GitHub API returns (paths, line counts, patches) and the parsed package
 * manifests. It never runs code from the pull request.
 */

export const LEVELS = { 1: 'Low', 2: 'Typical', 3: 'High', 4: 'Very high' }

/** Hidden marker that identifies the comment this workflow owns. */
export const COMMENT_MARKER = '<!-- evlog-risk-score -->'

const MAX_TEXT = 200
const MAX_ITEMS = 8
const LARGE_CHANGE = 500
const SMALL_CHANGE = 30

const isTest = path => /(^|\/)(test|tests|__tests__|__snapshots__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
const isShipped = path => /^packages\/[^/]+\/(src|bin)\//.test(path) && !isTest(path)
const isChangeset = path => /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path)
/** A published package's manifest, whose base and head contents `index.mjs` fetches. */
export const isManifest = path => /^packages\/[^/]+\/package\.json$/.test(path)
const isWorkflow = path => /^\.github\/(workflows|actions)\//.test(path)
// A rename counts under both paths, so moving a module out of a watched directory still matches.
const pathsOf = file => file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]
const lineCount = files => files.reduce((sum, f) => sum + f.additions + f.deletions, 0)

/**
 * Path rules, one per signal. `level` is the area level the rule raises the
 * area to when at least one changed file matches. `additive` lowers it to
 * Typical when the matched files only gain lines. `scaled` lowers it to Typical
 * when the matched files change {@link SMALL_CHANGE} lines or fewer and none
 * is removed or renamed.
 */
const RULES = [
  { area: 'compatibility', level: 3, additive: true, match: /^packages\/[^/]+\/tsdown\.config\.ts$/, reason: 'Changes the build entrypoints' },
  { area: 'compatibility', level: 3, additive: true, match: /^packages\/evlog\/test\/toolkit\/__snapshots__\/api-surface/, reason: 'Changes the public API snapshot' },
  { area: 'compatibility', level: 2, match: isShipped, reason: 'Changes shipped package source' },

  { area: 'sensitiveData', level: 3, match: /^packages\/evlog\/src\/(shared\/(headers|serialize-error)\.ts|enrichers\/|audit|better-auth\/|runtime\/server\/routes\/)/, reason: 'Touches headers, error serialization, audit or ingest code' },
  { area: 'sensitiveData', level: 3, scaled: true, match: /^packages\/evlog\/src\/redact\.ts$/, reason: 'Touches redaction' },
  { area: 'sensitiveData', level: 2, match: /^packages\/evlog\/src\/adapters\//, reason: 'Changes what drain adapters send to third parties' },

  { area: 'loggingOverhead', level: 3, scaled: true, match: /^packages\/evlog\/src\/(logger|pipeline|redact|stream)\.ts$|^packages\/evlog\/src\/shared\/(event|middleware|fork|asyncStorageScope|wideEventChannel|enricher)\.ts$|^packages\/evlog\/src\/enrichers\//, reason: 'Changes the per-event hot path' },
  { area: 'loggingOverhead', level: 3, match: /^packages\/evlog\/bench\/baseline\//, reason: 'Re-records the benchmark or bundle size baselines' },
  { area: 'loggingOverhead', level: 2, match: path => /^packages\/evlog\/src\//.test(path) && !isTest(path), reason: 'Changes code that runs inside the request lifecycle' },

  { area: 'delivery', level: 3, scaled: true, match: /^packages\/evlog\/src\/(adapters\/|pipeline\.ts$|http\.ts$|shared\/(drain|deferred-drain|http|chunk)\.ts$|nitro\/(deferred-drain|enrich-drain)\.ts$)/, reason: 'Changes how events are batched, retried or sent to drains' },
  { area: 'delivery', level: 2, match: /^packages\/evlog\/src\/(workers|next|nitro|nitro-v3|nuxt|sveltekit|hono|express|fastify|elysia|nestjs|react-router|orpc|effect)\//, reason: 'Changes when a framework integration flushes events' },

  { area: 'release', level: 4, match: /^\.changeset\/config\.json$/, reason: 'Changes how packages are versioned' },
  { area: 'release', level: 2, match: /^(scripts\/|turbo\.json$|pnpm-workspace\.yaml$|pnpm-lock\.yaml$|package\.json$)/, reason: 'Changes repository tooling or the lockfile' },
]

// Manifest fields that decide what consumers import, or where the package installs.
const ENTRY_FIELDS = ['exports', 'typesVersions', 'imports', 'main', 'module', 'types', 'typings', 'bin', 'files', 'type', 'sideEffects']
const INSTALL_FIELDS = ['engines', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies']
const FLOOR_RANGE = /^(\^|~|>=)(\d+)\.(\d+)\.(\d+)$/

/** True when `head` only raises the minimum of `base` within the same operator and major, as `>=4.13.14` to `>=4.13.17`. */
function raisesFloor(base, head) {
  const [b, h] = [FLOOR_RANGE.exec(base ?? ''), FLOOR_RANGE.exec(head ?? '')]
  if (!b || !h || b[1] !== h[1] || b[2] !== h[2]) return false
  return Number(h[3]) > Number(b[3]) || (h[3] === b[3] && Number(h[4]) >= Number(b[4]))
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
/** True when `head` keeps every value of `base`, nested keys included, and only adds new ones. */
const extends_ = (base, head) => isObject(base) && isObject(head)
  ? Object.keys(base).every(k => extends_(base[k], head[k]))
  : same(base, head)

/**
 * Classify a package manifest change from its parsed base and head contents
 * (`null` when the file is added or removed). Returns `entry`, `install`,
 * `peerFloors`, `addedOrRemovedDeps`, `depRanges` or `other` for the most
 * consequential difference, and whether the entrypoint change only adds entries.
 */
export function classifyManifest(base, head) {
  const before = base ?? {}
  const after = head ?? {}
  const changed = key => !same(before[key], after[key])
  if (ENTRY_FIELDS.some(changed))
    return { kind: 'entry', additive: base !== null && ENTRY_FIELDS.every(k => extends_(before[k], after[k])) }
  const peers = [before.peerDependencies ?? {}, after.peerDependencies ?? {}]
  const onlyFloors = same(Object.keys(peers[0]).sort(), Object.keys(peers[1]).sort())
    && Object.keys(peers[0]).every(k => peers[0][k] === peers[1][k] || raisesFloor(peers[0][k], peers[1][k]))
  if (INSTALL_FIELDS.some(k => k === 'peerDependencies' ? !onlyFloors : changed(k))) return { kind: 'install' }
  if (changed('peerDependencies')) return { kind: 'peerFloors' }
  const deps = [before.dependencies ?? {}, after.dependencies ?? {}].map(Object.keys)
  if (!same(deps[0].sort(), deps[1].sort())) return { kind: 'addedOrRemovedDeps' }
  if (changed('dependencies')) return { kind: 'depRanges' }
  return { kind: 'other' }
}

/** Lines the patch adds and removes, without the leading `+` or `-`. */
function changedLines(patch) {
  return (patch ?? '').split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map(l => l.slice(1))
}

// A workflow line that only moves a pinned action or tool version, once its trailing comment is dropped.
const PIN_LINE = /^(-\s+)?uses:\s*\S+@\S+$|^[A-Z0-9_]+_VERSION:\s*\S+$/
// A workflow line that grants permissions, reads a secret, or changes what code a privileged job checks out.
const CREDENTIAL_LINE = /secrets\.|_TOKEN\b|--token|permissions:|:\s*write\b|id-token|pull_request_target|persist-credentials|\bref:|environment:/i

/**
 * Classify a workflow or composite action change from its patch: `pins` when
 * every changed line only moves a pinned version, `credentials` when a changed
 * line touches permissions, secrets or the checked-out ref, `other` otherwise.
 * A file without a patch (too large for the API) counts as `credentials`.
 */
export function classifyWorkflow(patch) {
  if (patch === undefined) return 'credentials'
  const lines = changedLines(patch).map(l => l.replace(/(^|\s)#.*$/, '').trim()).filter(Boolean)
  if (lines.every(l => PIN_LINE.test(l))) return 'pins'
  return lines.some(l => CREDENTIAL_LINE.test(l)) ? 'credentials' : 'other'
}

const AREAS = [
  { key: 'compatibility', name: 'Compatibility', quiet: 'No change to the public API, package manifests or shipped source' },
  { key: 'sensitiveData', name: 'Sensitive data exposure', quiet: 'No change to redaction, headers, enrichers or adapter payloads' },
  { key: 'loggingOverhead', name: 'Logging overhead', quiet: 'No change to code on the per-event path' },
  { key: 'delivery', name: 'Delivery reliability', quiet: 'No change to drains, adapters or flush timing' },
  { key: 'release', name: 'CI and release', quiet: 'No change to workflows, publishing or repository tooling' },
]

// Added lines in shipped code that mention a credential or a request field that usually carries one.
const SENSITIVE_TOKENS = /\b(authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|apikey|access[_-]?token|bearer|private[_-]?key)\b/i
const isComment = line => /^\s*(\/\/|\/\*|\*)/.test(line)

/** Cut a string to Linear's 200 character limit. */
export function clip(text) {
  const trimmed = text.trim()
  return trimmed.length <= MAX_TEXT ? trimmed : `${trimmed.slice(0, MAX_TEXT - 1).trimEnd()}…`
}

function listFiles(paths) {
  const shown = paths.slice(0, 3).map(p => p.split('/').slice(-2).join('/'))
  return paths.length > 3 ? `${shown.join(', ')} and ${paths.length - 3} more` : shown.join(', ')
}

/**
 * The bump types declared in a changeset patch's frontmatter, e.g.
 * `'evlog': minor`. Context lines are read too, so a changeset edited after it
 * was added still counts. Only the first hunk can hold the frontmatter. When it
 * starts below line 1 its first `---` is the closing fence. When no closing
 * fence is visible, every line after the opening fence, or every line when the
 * hunk starts below it, is read as frontmatter.
 */
export function changesetBumps(patch) {
  const [hunk] = (patch ?? '').split(/\n(?=@@ )/)
  const lines = hunk.split('\n').filter(l => /^[+ ]/.test(l)).map(l => l.slice(1))
  const start = /^@@ -\S+ \+1[,\s]/.test(hunk) ? lines.findIndex(l => l.trim() === '---') : -1
  const closing = lines.findIndex((l, i) => i > start && l.trim() === '---')
  const bumps = new Set()
  for (const line of lines.slice(start + 1, closing === -1 ? lines.length : closing)) {
    const match = line.match(/^\s*['"]?[@\w./-]+['"]?\s*:\s*(major|minor|patch)\s*$/)
    if (match) bumps.add(match[1])
  }
  return bumps
}

/** Lines the patch adds, without the leading `+`. */
function addedLines(patch) {
  return (patch ?? '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1))
}

/**
 * Score a pull request from its title and changed files.
 *
 * Each area takes the highest level of the rules that matched it. The overall
 * level is the highest area level, raised to High when the shipped source
 * change exceeds {@link LARGE_CHANGE} lines.
 *
 * Package manifests are scored by which fields changed, from their parsed
 * contents in `manifests`, keyed by head path. A manifest missing from it is
 * scored High, since nothing shows which fields changed.
 *
 * @param {{ title: string, files: Array<{ filename: string, status: string, additions: number, deletions: number, patch?: string, previous_filename?: string }>, manifests?: Record<string, { base: object | null, head: object | null }> }} pr
 */
export function assessRisk({ title, files, manifests = {} }) {
  const areas = new Map(AREAS.map(a => [a.key, { ...a, level: 1, reasons: [] }]))
  const raise = (key, level, reason) => {
    const area = areas.get(key)
    area.level = Math.max(area.level, level)
    area.reasons.push({ level, text: reason })
  }
  // Raise once per reason, listing every file that gave it.
  const raiseEach = (key, findings) => {
    const groups = Map.groupBy(findings, ({ level, reason }) => `${level}\n${reason}`)
    for (const group of groups.values())
      raise(key, group[0].level, `${group[0].reason}: ${listFiles(group.map(g => g.path))}`)
  }

  for (const rule of RULES) {
    const test = typeof rule.match === 'function' ? rule.match : p => rule.match.test(p)
    const matched = files.filter(f => pathsOf(f).some(test))
    if (matched.length === 0) continue
    let level = rule.level
    let reason = rule.reason
    if (rule.additive && matched.every(f => f.deletions === 0)) {
      level = 2
      reason = `${reason}, additions only`
    }
    else if (rule.scaled && lineCount(matched) <= SMALL_CHANGE && matched.every(f => f.status === 'modified' || f.status === 'added')) {
      level = 2
      reason = `${reason} (${lineCount(matched)} lines)`
    }
    // A broader rule adds nothing once a stricter rule already explained the same area.
    if (!areas.get(rule.area).reasons.some(r => r.level >= level))
      raise(rule.area, level, `${reason}: ${listFiles(matched.map(f => pathsOf(f).find(test)))}`)
  }

  raiseEach('compatibility', files.filter(f => isManifest(f.filename)).map((f) => {
    const contents = manifests[f.filename]
    if (!contents) return { path: f.filename, level: 3, reason: 'Changes a package manifest' }
    const { kind, additive } = classifyManifest(contents.base, contents.head)
    const [level, reason] = {
      entry: additive ? [2, 'Adds package entrypoints'] : [3, 'Changes or removes package entrypoints (exports, bin, files)'],
      install: [3, 'Changes peer dependency ranges or engines'],
      peerFloors: [2, 'Raises peer dependency minimums within their major'],
      addedOrRemovedDeps: [3, 'Adds or removes a runtime dependency'],
      depRanges: [2, 'Moves runtime dependency ranges'],
      other: [1, 'Changes dev dependencies, scripts or package metadata'],
    }[kind]
    return { path: f.filename, level, reason }
  }).filter(f => f.level > 1))

  raiseEach('release', files.filter(f => isWorkflow(f.filename)).map((f) => {
    const kind = classifyWorkflow(f.patch)
    const [level, reason] = kind === 'pins'
      ? [2, 'Moves pinned action or tool versions in CI']
      : /^\.github\/workflows\/release\.yml$/.test(f.filename)
        ? [4, 'Changes how packages are published to npm']
        : kind === 'credentials' ? [3, 'Changes permissions, secrets or the checked-out ref in CI'] : [2, 'Changes CI steps']
    return { path: f.filename, level, reason }
  }))

  const pre = files.find(f => f.filename === '.changeset/pre.json')
  if (pre) {
    if (changedLines(pre.patch).some(l => /"(mode|tag)"/.test(l)) || pre.patch === undefined)
      raise('release', 4, 'Enters or leaves changesets pre mode: .changeset/pre.json')
    else
      raise('release', 2, 'Records changesets for the prerelease: .changeset/pre.json')
  }

  const shipped = files.filter(f => pathsOf(f).some(isShipped))
  const removed = shipped.filter(f => f.status === 'removed' || f.status === 'renamed')
  if (removed.length > 0)
    raise('compatibility', 3, `Removes or renames shipped modules: ${listFiles(removed.map(f => f.previous_filename ?? f.filename))}`)

  const bumps = new Set(files.filter(f => isChangeset(f.filename)).flatMap(f => [...changesetBumps(f.patch)]))
  const breakingTitle = /^(\w+)(\([^)]*\))?!:/.test(title) || /^breaking(\(|:)/.test(title)
  if (bumps.has('major') || breakingTitle)
    raise('compatibility', 4, breakingTitle ? 'The title marks the change as breaking' : 'A changeset declares a major bump')
  else if (bumps.has('minor'))
    raise('compatibility', 2, 'A changeset declares a minor bump (new public behavior)')

  const sensitive = shipped.filter(f => addedLines(f.patch).some(l => !isComment(l) && SENSITIVE_TOKENS.test(l)))
  if (sensitive.length > 0)
    raise('sensitiveData', 3, `Added lines mention credentials or auth headers: ${listFiles(sensitive.map(f => f.filename))}`)

  const result = [...areas.values()].map(a => ({
    name: a.name,
    level: a.level,
    explanation: clip(a.reasons.length > 0
      ? a.reasons.sort((x, y) => y.level - x.level).map(r => r.text).join('; ')
      : a.quiet),
  }))

  const shippedLines = shipped.reduce((sum, f) => sum + f.additions + f.deletions, 0)
  const testsTouched = files.some(f => isTest(f.filename))
  const explanations = [
    shipped.length > 0
      ? `${files.length} files changed, ${shipped.length} in shipped package source (${shippedLines} lines)`
      : `${files.length} files changed, none in shipped package source`,
  ]
  let level = Math.max(...result.map(a => a.level))
  if (shipped.length > 0 && !testsTouched)
    explanations.push('Shipped source changes without any test change')
  if (shippedLines > LARGE_CHANGE) {
    level = Math.max(level, 3)
    explanations.push(`Large change to shipped source (${shippedLines} lines)`)
  }
  if (shipped.length > 0 && bumps.size === 0)
    explanations.push('Shipped source changes without a changeset')
  for (const area of [...result].sort((a, b) => b.level - a.level)) {
    if (area.level >= 3) explanations.push(`${area.name}: ${area.explanation}`)
  }

  return { level, explanations: explanations.slice(0, MAX_ITEMS).map(clip), areas: result }
}

const isText = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_TEXT
const isLevel = value => Number.isInteger(value) && value >= 1 && value <= 4
const onlyKeys = (object, keys) => Object.keys(object).every(k => keys.includes(k))

/**
 * Throw when an entry would fail Linear's riskScore validation. Linear drops
 * the whole score on any invalid field, so publishing one would fail silently.
 */
export function validateRiskScore(entry) {
  const fail = (why) => { throw new Error(`invalid riskScore entry: ${why}`) }
  if (!onlyKeys(entry, ['plugin', 'sha', 'level', 'explanations', 'areas'])) fail('unknown field')
  if (entry.plugin !== 'riskScore') fail('plugin must be "riskScore"')
  if (!isLevel(entry.level)) fail('level must be an integer from 1 to 4')
  if (entry.sha !== undefined && !/^[0-9a-f]{40}$/i.test(entry.sha)) fail('sha must be a 40-character hexadecimal commit SHA')
  if (entry.explanations !== undefined) {
    if (!Array.isArray(entry.explanations) || entry.explanations.length > MAX_ITEMS) fail(`explanations must be an array of at most ${MAX_ITEMS}`)
    if (!entry.explanations.every(isText)) fail(`each explanation must be a non-empty string of at most ${MAX_TEXT} characters`)
  }
  if (entry.areas !== undefined) {
    if (!Array.isArray(entry.areas) || entry.areas.length > MAX_ITEMS) fail(`areas must be an array of at most ${MAX_ITEMS}`)
    for (const area of entry.areas) {
      if (!onlyKeys(area, ['name', 'level', 'explanation'])) fail(`unknown field in area "${area.name}"`)
      if (typeof area.name !== 'string' || area.name.includes('\n') || area.name.trim().length === 0 || area.name.trim().length > 60) fail('area name must be a single line of 1 to 60 characters')
      if (!isLevel(area.level)) fail(`area "${area.name}" level must be an integer from 1 to 4`)
      if (area.explanation !== undefined && !isText(area.explanation)) fail(`area "${area.name}" explanation must be a non-empty string of at most ${MAX_TEXT} characters`)
    }
  }
  return entry
}

/**
 * The comment body: a `linear:extension` block bound to `sha`, then the same
 * assessment in readable form for GitHub.
 */
export function renderComment({ sha, assessment }) {
  const entry = validateRiskScore({ plugin: 'riskScore', sha, ...assessment })
  const block = `<!-- linear:extension ${JSON.stringify({ version: 1, plugins: [entry] })} -->`
  const rows = [...assessment.areas]
    .sort((a, b) => b.level - a.level)
    .map(a => `| ${a.name} | ${LEVELS[a.level]} | ${a.explanation.replaceAll('|', '\\|')} |`)
  return [
    COMMENT_MARKER,
    block,
    `### Risk score: ${LEVELS[assessment.level]} (${assessment.level}/4)`,
    '',
    `Assessed at ${sha.slice(0, 7)} from the changed files and the title, by \`scripts/risk-score\`. A new push replaces this score.`,
    '',
    ...assessment.explanations.map(e => `- ${e}`),
    '',
    '| Area | Level | Why |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n')
}
