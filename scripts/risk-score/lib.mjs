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
const PROMPT_CHANGE = 50

const isTest = path => /(^|\/)(test|tests|__tests__|__snapshots__|evals)\//.test(path) || /\.(test|spec|eval)\.[cm]?[jt]sx?$/.test(path)
const isCode = path => /\.([cm]?[jt]sx?|vue)$/.test(path)
const isShipped = path => /^packages\/[^/]+\/(src|bin)\//.test(path) && !isTest(path)
const isChangeset = path => /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path)
/** A published package's manifest, whose base and head contents `index.mjs` fetches. */
export const isManifest = path => /^packages\/[^/]+\/package\.json$/.test(path)
const isWorkflow = path => /^\.github\/(workflows|actions)\//.test(path)
const isMigration = path => /^apps\/telemetry\/server\/db\/migrations\/.+\.sql$/.test(path)
const isPrompt = path => /^apps\/evi\/agent\/(instructions\.md$|instructions\/)/.test(path)
// A rename counts under both paths, so moving a module out of a watched directory still matches.
const pathsOf = file => file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]
const lineCount = files => files.reduce((sum, f) => sum + f.additions + f.deletions, 0)

const INTEGRATIONS = 'ai|better-auth|effect|elysia|eve|express|fastify|hono|nestjs|next|nitro|nitro-v3|nuxt|orpc|react-router|runtime|sveltekit|vite|workers'

/**
 * The parts of the repository a pull request can touch, each scored as one
 * Linear area. A file belongs to the first component that matches one of its
 * paths. `pkg` names the npm package the component ships in; `deploys` names
 * what a merge to main deploys.
 */
const COMPONENTS = [
  { key: 'adapters', name: 'evlog adapters', pkg: 'evlog', match: /^packages\/evlog\/(src|test)\/adapters\// },
  { key: 'integrations', name: 'evlog integrations', pkg: 'evlog', match: new RegExp(`^packages/evlog/(src/(${INTEGRATIONS}|nitro\\.ts)(/|$)|test/(${INTEGRATIONS}|frameworks|nitro-v2)/|test/eve)`) },
  { key: 'core', name: 'evlog core', pkg: 'evlog', match: /^packages\/evlog\// },
  { key: 'cli', name: '@evlog/cli', pkg: '@evlog/cli', match: /^packages\/cli\// },
  { key: 'telemetry', name: '@evlog/telemetry', pkg: '@evlog/telemetry', match: /^packages\/telemetry\// },
  { key: 'signals', name: '@evlog/signals', pkg: '@evlog/signals', match: /^packages\/signals\// },
  { key: 'nuxthub', name: '@evlog/nuxthub', pkg: '@evlog/nuxthub', match: /^packages\/nuxthub\// },
  { key: 'evi', name: 'Evi agent', deploys: 'Evi', match: /^apps\/evi\// },
  { key: 'dashboard', name: 'Telemetry dashboard', deploys: 'the telemetry dashboard', match: /^apps\/telemetry\// },
  { key: 'sites', name: 'Docs and sites', deploys: 'the docs and sites', match: /^(apps\/(docs|just-use-evlog|lab)\/|skills\/)/ },
  { key: 'ci', name: 'CI and release', match: /^(\.github\/|\.changeset\/(config|pre)\.json$|scripts\/|turbo\.json$|\.agents\/setup$)/ },
  { key: 'deps', name: 'Dependencies', match: /^(pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json|renovate\.json|\.node-version|\.nvmrc)$/ },
  { key: 'repo', name: 'Examples and repository', match: /./ },
]
const componentOf = file => COMPONENTS.find(c => pathsOf(file).some(p => c.match.test(p)))
/** The component a package-wide finding, such as a release or a major bump, lands on when none of the package's components is touched. */
const PRIMARY = { 'evlog': 'core', '@evlog/cli': 'cli', '@evlog/telemetry': 'telemetry', '@evlog/signals': 'signals', '@evlog/nuxthub': 'nuxthub' }
const packageOfManifest = path => ({ evlog: 'evlog' })[path.split('/')[1]] ?? `@evlog/${path.split('/')[1]}`

/**
 * Path rules. `level` is the level a matched file raises its component to.
 * `additive` lowers it to Typical when the matched files only gain lines.
 * `scaled` lowers it to Typical when the matched files change
 * {@link SMALL_CHANGE} lines or fewer and none is removed or renamed.
 */
const RULES = [
  { level: 3, concern: 'Compatibility', additive: true, match: /^packages\/[^/]+\/tsdown\.config\.ts$/, reason: 'changes the build entrypoints' },
  { level: 3, concern: 'Compatibility', additive: true, match: /^packages\/evlog\/test\/toolkit\/__snapshots__\/api-surface/, reason: 'changes the public API snapshot' },
  { level: 3, concern: 'Privacy', match: /^packages\/evlog\/src\/(shared\/(headers|serialize-error)\.ts|enrichers\/|audit|better-auth\/|runtime\/server\/routes\/)/, reason: 'touches headers, error serialization, audit or ingest code' },
  { level: 3, concern: 'Privacy', scaled: true, match: /^packages\/evlog\/src\/redact\.ts$/, reason: 'touches redaction' },
  { level: 3, concern: 'Performance', scaled: true, match: /^packages\/evlog\/src\/(logger|pipeline|redact|stream)\.ts$|^packages\/evlog\/src\/shared\/(event|middleware|fork|asyncStorageScope|wideEventChannel|enricher)\.ts$|^packages\/evlog\/src\/enrichers\//, reason: 'changes the per-event hot path' },
  { level: 3, concern: 'Performance', match: /^packages\/evlog\/bench\/baseline\//, reason: 're-records the benchmark or bundle size baselines' },
  { level: 3, concern: 'Delivery', scaled: true, match: /^packages\/evlog\/src\/(pipeline\.ts$|http\.ts$|shared\/(drain|deferred-drain|http|chunk)\.ts$|nitro\/(deferred-drain|enrich-drain)\.ts$)/, reason: 'changes how events are batched, retried or sent to drains' },
  { level: 3, concern: 'Delivery', scaled: true, match: /^packages\/evlog\/src\/adapters\//, reason: 'changes what an adapter sends to its provider, and how' },

  { level: 3, concern: 'User files', match: /^packages\/cli\/src\/(commands\/(init|agents)\.ts$|lib\/(init|agents)\/|lib\/map\/write\.ts$)/, reason: 'changes commands that write into users\' projects' },
  { level: 3, concern: 'Privacy', match: /^packages\/cli\/src\/(commands|lib)\/telemetry\.ts$/, reason: 'changes what the CLI reports as telemetry' },

  { level: 4, concern: 'Privacy', match: /^packages\/telemetry\/src\/(consent|disclosure|notice|sanitize|enrich)\.ts$/, reason: 'changes consent, what users are told, or what leaves their machine' },
  { level: 3, concern: 'Ingest', match: /^packages\/telemetry\/src\/ingest\.ts$/, reason: 'changes how the dashboard validates incoming runs' },
  { level: 3, concern: 'Delivery', match: /^packages\/telemetry\/src\/(drain|outbox|flush-policy|paths|idempotency)\.ts$/, reason: 'changes when telemetry is sent or what it stores on users\' disks' },

  { level: 3, concern: 'Spend', match: /^packages\/signals\/src\/(budget|cache|evaluate)\.ts$/, reason: 'changes how often signals call the model' },

  { level: 4, concern: 'Access', match: /^apps\/evi\/agent\/(lib\/(trust|maintainer-auth|connect|vercel-env)\.ts$|lib\/github\/credentials\.ts$|connections\/|tools\/set-vercel-env\.ts$)/, reason: 'changes who Evi trusts or which credentials it holds' },
  { level: 3, concern: 'External writes', match: /^apps\/evi\/agent\/(extensions\/(github\.ts|git\/extension\.ts)$|lib\/github\/|lib\/(slack|channel|photon)\.ts$|channels\/|tools\/git\.ts$)/, reason: 'changes how Evi writes to GitHub, Linear or Slack' },
  { level: 3, concern: 'Sandbox', match: /^apps\/evi\/agent\/(sandbox\.ts$|lib\/[^/]*sandbox[^/]*\.ts$|lib\/(capture|workspace|workspace-bootstrap)\.ts$|tools\/capture\.ts$|extensions\/browser\.ts$)/, reason: 'changes what Evi can run or reach' },
  { level: 3, concern: 'Spend', match: /^apps\/evi\/agent\/(agent\.ts$|lib\/(model|gateway)\.ts$|tools\/ai-gateway\.ts$|schedules\/)/, reason: 'changes the model, its routing or what runs unattended' },
  { level: 3, concern: 'Privacy', match: /^apps\/evi\/agent\/(instrumentation\/|hooks\/evlog\.ts$|lib\/(posthog-spans|drains)\.ts$)/, reason: 'changes what reaches PostHog or log drains' },
  { level: 2, concern: 'Behavior', match: /^apps\/evi\/agent\/(skills\/|subagents\/|extensions\/git\/skills\/)/, reason: 'changes skills or subagent prompts' },

  { level: 4, concern: 'Access', match: /^apps\/telemetry\/server\/(api\/(login|logout)\.post\.ts$|api\/auth\/|utils\/(session|password|mcp-auth|vercel-oidc|allowed-tools)\.ts$)/, reason: 'changes dashboard login, sessions or MCP access' },
  { level: 3, concern: 'Ingest', match: /^apps\/telemetry\/server\/(api\/telemetry\/ingest\.post\.ts|utils\/(rate-limit|store)\.ts)$/, reason: 'changes the public endpoint CLIs send telemetry to, or how runs are stored' },
  { level: 3, concern: 'Data', match: /^apps\/telemetry\/server\/db\/schema\.ts$/, reason: 'changes the database schema' },
]

/** The level and reason of a file no rule matched, from where it lives. */
function defaultFinding(component, path) {
  const app = path.split('/').slice(2).join('/')
  switch (component.key) {
    case 'core':
    case 'cli':
    case 'telemetry':
    case 'signals':
    case 'nuxthub':
      if (isShipped(path)) return [2, 'Behavior', 'changes shipped source']
      return /\.md$/.test(path) ? [1, null, 'docs or changelog'] : [1, null, 'package tooling or config']
    case 'integrations':
      return [2, 'Behavior', 'changes a framework integration']
    case 'evi':
      if (/^(package\.json|vercel\.json)$/.test(app)) return [2, 'Deploy', 'changes dependencies or deploy config']
      return isCode(path) ? [2, 'Behavior', 'changes agent code'] : [1, null, 'docs, notes or ledgers']
    case 'dashboard':
      if (/^(package\.json|vercel\.json|nuxt\.config\.ts)$/.test(app)) return [2, 'Deploy', 'changes dependencies or deploy config']
      if (/^server\/db\/migrations\/meta\//.test(app)) return [1, null, 'generated migration snapshots']
      if (/^(server|shared)\//.test(app)) return [2, 'Behavior', 'changes server code']
      return [1, null, 'changes the dashboard UI']
    case 'sites':
      return /^(server\/|package\.json$|vercel\.json$|nuxt\.config\.ts$)/.test(app)
        ? [2, 'Deploy', 'changes site server code or deploy config']
        : [1, null, 'changes pages, content or published skills']
    case 'ci':
      if (/^scripts\//.test(path) && isCode(path)) return [2, 'Tooling', 'changes repository scripts']
      return path === 'turbo.json' ? [2, 'Tooling', 'changes the build pipeline'] : [1, null, 'repository config']
    case 'deps':
      return path === 'renovate.json' ? [1, null, 'Renovate config'] : [2, 'Dependencies', 'changes dependencies or the lockfile']
    default:
      return [1, null, 'examples, playgrounds or agent guidance']
  }
}

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

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/

/**
 * What publishing `head` after `base` means, from the two `version` fields:
 * `first` for a package with no earlier version, `stable` for a prerelease
 * line reaching its release, `prerelease` for another build on the same
 * prerelease line, else `major`, `minor` or `patch`. `null` when the version
 * did not change.
 */
export function releaseKind(base, head) {
  if (head === undefined || base === head) return null
  const [b, h] = [SEMVER.exec(base ?? ''), SEMVER.exec(head)]
  if (!b || !h) return 'first'
  const core = m => m.slice(1, 4).join('.')
  if (core(b) === core(h)) return h[4] ? 'prerelease' : 'stable'
  if (b[1] !== h[1]) return 'major'
  return b[2] !== h[2] ? 'minor' : 'patch'
}

const RELEASE_LEVELS = { first: 4, stable: 4, major: 4, minor: 3, patch: 2, prerelease: 2 }

/** Lines the patch adds and removes, without the leading `+` or `-`. */
function changedLines(patch) {
  return (patch ?? '').split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map(l => l.slice(1))
}

/** Lines the patch adds, without the leading `+`. */
function addedLines(patch) {
  return (patch ?? '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1))
}

const isComment = line => /^\s*(\/\/|\/\*|\*|<!--)/.test(line)
/**
 * True when a code file's change cannot alter behavior: once comments, trailing
 * `//` comments and blank lines are dropped, the lines it removes are the lines
 * it adds, so it only edits comments or moves code.
 */
function onlyComments(file) {
  if (!isCode(file.filename) || file.patch === undefined || file.status !== 'modified') return false
  const code = sign => file.patch.split('\n')
    .filter(l => l.startsWith(sign) && !l.startsWith(sign.repeat(3)))
    .map(l => l.slice(1))
    .filter(l => !isComment(l))
    .map(l => l.replace(/\s+\/\/.*$/, '').trim())
    .filter(Boolean)
    .sort()
  return same(code('+'), code('-'))
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

// A migration line that removes or rewrites existing data rather than adding to it.
const DESTRUCTIVE_SQL = /\b(drop|rename|truncate|delete\s+from|alter\s+column|set\s+data\s+type)\b/i

// Added lines in shipped code that mention a credential or a request field that usually carries one.
const SENSITIVE_TOKENS = /\b(authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|apikey|access[_-]?token|bearer|private[_-]?key)\b/i

/** Cut a string to Linear's 200 character limit. */
export function clip(text) {
  const trimmed = text.trim()
  return trimmed.length <= MAX_TEXT ? trimmed : `${trimmed.slice(0, MAX_TEXT - 1).trimEnd()}…`
}

function listFiles(paths) {
  const unique = [...new Set(paths)]
  const shown = unique.slice(0, 3).map(p => p.split('/').slice(-2).join('/'))
  return unique.length > 3 ? `${shown.join(', ')} and ${unique.length - 3} more` : shown.join(', ')
}

const joinNames = names => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * The packages and bump types declared in a changeset patch's frontmatter,
 * e.g. `'evlog': minor`, as a map from package name to bump. Context lines
 * are read too, so a changeset edited after it was added still counts. Only
 * the first hunk can hold the frontmatter. When it starts below line 1 its
 * first `---` is the closing fence. When no closing fence is visible, every
 * line after the opening fence, or every line when the hunk starts below it,
 * is read as frontmatter.
 */
export function changesetBumps(patch) {
  const [hunk] = (patch ?? '').split(/\n(?=@@ )/)
  const lines = hunk.split('\n').filter(l => /^[+ ]/.test(l)).map(l => l.slice(1))
  const start = /^@@ -\S+ \+1[,\s]/.test(hunk) ? lines.findIndex(l => l.trim() === '---') : -1
  const closing = lines.findIndex((l, i) => i > start && l.trim() === '---')
  const bumps = new Map()
  for (const line of lines.slice(start + 1, closing === -1 ? lines.length : closing)) {
    const match = line.match(/^\s*['"]?([@\w./-]+)['"]?\s*:\s*(major|minor|patch)\s*$/)
    if (match) bumps.set(match[1], match[2])
  }
  return bumps
}

const BUMP_ORDER = ['patch', 'minor', 'major']

/**
 * Score a pull request from its title, author and changed files.
 *
 * Every changed file belongs to one component of the repository, and each
 * touched component becomes one area, at the highest level of its files.
 * The overall level is the highest area level.
 *
 * Package manifests are scored by which fields changed, from their parsed
 * contents in `manifests`, keyed by head path; a changed `version` field is a
 * release. A manifest missing from it is scored High, since nothing shows
 * which fields changed.
 *
 * @param {{ title: string, author?: { login: string, fork: boolean, association?: string }, files: Array<{ filename: string, status: string, additions: number, deletions: number, patch?: string, previous_filename?: string }>, manifests?: Record<string, { base: object | null, head: object | null }> }} pr
 */
export function assessRisk({ title, author, files, manifests = {} }) {
  const entries = files.filter(f => !isChangeset(f.filename)).map(f => ({
    file: f,
    path: f.filename,
    component: componentOf(f),
    test: pathsOf(f).every(isTest),
    comments: onlyComments(f),
  }))
  const findings = []
  const find = (entry, level, concern, reason, path = entry.path) => findings.push({ entry, component: entry.component, level, concern, reason, path })
  // A finding about a whole package, such as a release, that no single changed file carries.
  const findForPackage = (pkg, level, concern, reason, path) => {
    const touched = entries.filter(e => e.component.pkg === pkg && !e.test)
    const keys = touched.length > 0 ? new Set(touched.map(e => e.component.key)) : new Set([PRIMARY[pkg]])
    for (const key of keys)
      findings.push({ component: COMPONENTS.find(c => c.key === key), level, concern, reason, path })
  }
  const live = entries.filter(e => !e.test && !e.comments)

  for (const rule of RULES) {
    const test = typeof rule.match === 'function' ? rule.match : p => rule.match.test(p)
    const matched = live.filter(e => pathsOf(e.file).some(test))
    if (matched.length === 0) continue
    let level = rule.level
    let reason = rule.reason
    if (rule.additive && matched.every(e => e.file.deletions === 0)) {
      level = 2
      reason = `${reason}, additions only`
    }
    else if (rule.scaled && lineCount(matched.map(e => e.file)) <= SMALL_CHANGE && matched.every(e => e.file.status === 'modified' || e.file.status === 'added')) {
      level = 2
      reason = `${reason} (${lineCount(matched.map(e => e.file))} lines)`
    }
    for (const e of matched) findings.push({ entry: e, component: e.component, level, concern: rule.concern, reason, path: pathsOf(e.file).find(test) })
  }

  const prompt = live.filter(e => isPrompt(e.path))
  if (prompt.length > 0) {
    const lines = lineCount(prompt.map(e => e.file))
    const [level, reason] = lines > PROMPT_CHANGE ? [3, `rewrites the always-on prompt (${lines} lines)`] : [2, `changes the always-on prompt (${lines} lines)`]
    for (const e of prompt) find(e, level, 'Behavior', reason)
  }

  for (const e of live.filter(e => isMigration(e.path))) {
    const destructive = e.file.patch === undefined || e.file.status !== 'added' || addedLines(e.file.patch).some(l => DESTRUCTIVE_SQL.test(l))
    find(e, destructive ? 4 : 3, 'Data', destructive ? 'a migration drops, renames or rewrites existing data' : 'adds a database migration')
  }

  const releases = []
  for (const e of entries.filter(e => isManifest(e.path))) {
    const contents = manifests[e.path]
    if (!contents) {
      find(e, 3, 'Compatibility', 'changes a package manifest')
      continue
    }
    const pkg = contents.head?.name ?? contents.base?.name ?? packageOfManifest(e.path)
    const kind = releaseKind(contents.base?.version, contents.head?.version)
    if (kind && contents.head && !contents.head.private) {
      releases.push({ pkg, version: contents.head.version, kind })
      find(e, RELEASE_LEVELS[kind], 'Release', `publishes ${contents.head.version} (${kind === 'first' ? 'first release' : kind})`)
    }
    const { kind: change, additive } = classifyManifest(contents.base, contents.head)
    const [level, reason] = {
      entry: additive ? [2, 'adds package entrypoints'] : [3, 'changes or removes package entrypoints (exports, bin, files)'],
      install: [3, 'changes peer dependency ranges or engines'],
      peerFloors: [2, 'raises peer dependency minimums within their major'],
      addedOrRemovedDeps: [3, 'adds or removes a runtime dependency'],
      depRanges: [2, 'moves runtime dependency ranges'],
      other: [1, null],
    }[change]
    if (level > 1) find(e, level, 'Compatibility', reason)
    else if (!kind) find(e, 1, null, 'dev dependencies, scripts or package metadata')
  }

  for (const e of live.filter(e => isWorkflow(e.path))) {
    const kind = classifyWorkflow(e.file.patch)
    if (kind === 'pins') find(e, 2, 'Release', 'moves pinned action or tool versions in CI')
    else if (/^\.github\/workflows\/release\.yml$/.test(e.path)) find(e, 4, 'Release', 'changes how packages are published to npm')
    else if (kind === 'credentials') find(e, 3, 'Release', 'changes permissions, secrets or the checked-out ref in CI')
    else find(e, 2, 'Release', 'changes CI steps')
  }

  const pre = entries.find(e => e.path === '.changeset/pre.json')
  if (pre) {
    if (pre.file.patch === undefined || changedLines(pre.file.patch).some(l => /"(mode|tag)"/.test(l)))
      find(pre, 4, 'Release', 'enters or leaves changesets pre mode')
    else
      find(pre, 2, 'Release', 'records changesets for the prerelease')
  }

  for (const e of live.filter(e => pathsOf(e.file).some(isShipped) && (e.file.status === 'removed' || e.file.status === 'renamed')))
    find(e, 3, 'Compatibility', 'removes or renames shipped modules', e.file.previous_filename ?? e.path)

  const bumps = new Map()
  for (const f of files.filter(f => isChangeset(f.filename))) {
    for (const [pkg, bump] of changesetBumps(f.patch)) {
      if (BUMP_ORDER.indexOf(bump) > BUMP_ORDER.indexOf(bumps.get(pkg))) bumps.set(pkg, bump)
    }
  }
  const breakingTitle = /^(\w+)(\([^)]*\))?!:/.test(title) || /^breaking(\(|:)/.test(title)
  const shippedPackages = [...new Set(live.filter(e => isShipped(e.path)).map(e => e.component.pkg))]
  for (const [pkg, bump] of bumps) {
    if (bump === 'major') findForPackage(pkg, 4, 'Compatibility', 'a changeset declares a major bump')
    else if (bump === 'minor' && entries.some(e => e.component.pkg === pkg)) findForPackage(pkg, 2, 'Compatibility', 'a changeset declares a minor bump (new public behavior)')
  }
  if (breakingTitle) {
    for (const pkg of shippedPackages.length > 0 ? shippedPackages : ['evlog'])
      findForPackage(pkg, 4, 'Compatibility', 'the title marks the change as breaking')
  }

  for (const e of live.filter(e => isShipped(e.path) && addedLines(e.file.patch).some(l => !isComment(l) && SENSITIVE_TOKENS.test(l))))
    find(e, 3, 'Privacy', 'added lines mention credentials or auth headers')

  for (const e of entries.filter(e => !findings.some(f => f.entry === e))) {
    if (e.test) find(e, 1, null, 'tests only')
    else if (e.comments) find(e, 1, null, 'comments or moved code only')
    else find(e, ...defaultFinding(e.component, e.path))
  }

  // Size counts only code that can change behavior, so lockfiles, baselines and docs do not inflate it.
  const codeLines = new Map()
  for (const e of entries.filter(e => !e.test && isCode(e.path) && findings.some(f => f.entry === e && f.level >= 2)))
    codeLines.set(e.component, (codeLines.get(e.component) ?? 0) + e.file.additions + e.file.deletions)
  for (const [component, lines] of codeLines) {
    if (lines > LARGE_CHANGE) findings.push({ component, level: 3, concern: 'Size', reason: `large change (${lines} lines)`, path: null })
  }

  const areas = COMPONENTS.flatMap((component) => {
    const own = findings.filter(f => f.component === component)
    if (own.length === 0) return []
    const groups = Map.groupBy(own, f => `${f.level}\n${f.concern}\n${f.reason}`)
    const reasons = [...groups.values()]
      .sort((a, b) => b[0].level - a[0].level)
      .map((group) => {
        const { level, concern, reason } = group[0]
        const paths = group.map(f => f.path).filter(Boolean)
        const text = paths.length > 0 ? `${reason}: ${listFiles(paths)}` : reason
        return { level, text: concern ? `${concern}: ${text}` : `${text[0].toUpperCase()}${text.slice(1)}` }
      })
    return [{
      component,
      level: Math.max(...own.map(f => f.level)),
      explanation: clip(reasons.map(r => r.text).join('; ')),
      // The top-level list repeats only what raises the risk, not the tests and docs around it.
      summary: clip(reasons.filter(r => r.level >= 2).map(r => r.text).join('; ')),
    }]
  }).sort((a, b) => b.level - a.level)

  const level = Math.max(1, ...areas.map(a => a.level))

  const explanations = [onMerge({ entries, findings, releases, bumps })]
  for (const area of areas.filter(a => a.level >= Math.max(2, Math.min(level, 3))))
    explanations.push(clip(`${area.component.name}: ${area.summary}`))

  for (const component of COMPONENTS.filter(c => c.pkg || c.key === 'evi' || c.key === 'dashboard')) {
    const own = entries.filter(e => e.component === component)
    const code = own.filter(e => !e.test && !e.comments && isCode(e.path) && findings.some(f => f.entry === e && f.level >= 2))
    if (code.length > 0 && !own.some(e => e.test))
      explanations.push(`No test changed in ${component.name}: ${listFiles(code.map(e => e.path))}`)
  }
  if (releases.length === 0) {
    const missing = shippedPackages.filter(pkg => !bumps.has(pkg))
    if (missing.length > 0) explanations.push(`No changeset names ${joinNames(missing)}, though its shipped source changed`)
  }
  if (author?.fork) {
    const first = ['FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE'].includes(author.association)
    explanations.push(`Opened from a fork by @${author.login}${first ? ', a first-time contributor' : ''}`)
  }
  explanations.push(`${files.length} files changed (${lineCount(files)} lines), ${entries.filter(e => e.test).length} of them tests`)

  // The totals line always survives the cut: it is what tells a reader how big the change is.
  const kept = explanations.length <= MAX_ITEMS ? explanations : [...explanations.slice(0, MAX_ITEMS - 1), explanations.at(-1)]
  return {
    level,
    explanations: kept.map(clip),
    areas: mergeOverflow(areas).map(a => ({ name: a.component.name, level: a.level, explanation: a.explanation })),
  }
}

/** Keep Linear's 8 area limit by folding the lowest areas into one. */
function mergeOverflow(areas) {
  if (areas.length <= MAX_ITEMS) return areas
  const rest = areas.slice(MAX_ITEMS - 1)
  return [...areas.slice(0, MAX_ITEMS - 1), {
    component: { name: 'Other' },
    level: Math.max(...rest.map(a => a.level)),
    explanation: clip(`Also touches ${joinNames(rest.map(a => a.component.name))}`),
  }]
}

/** One line on what merging the pull request does: what it publishes, ships at the next release, or deploys. */
function onMerge({ entries, findings, releases, bumps }) {
  const parts = []
  if (releases.length > 0)
    parts.push(`publishes ${joinNames(releases.map(r => `${r.pkg} ${r.version} (${r.kind === 'first' ? 'first release' : r.kind})`))}`)
  else {
    const ships = e => (isShipped(e.path) && !e.comments) || (isManifest(e.path) && findings.some(f => f.entry === e && f.level >= 2))
    const shipped = [...new Set(entries.filter(ships).map(e => e.component.pkg))]
    if (shipped.length > 0)
      parts.push(`ships ${joinNames(shipped.map(pkg => bumps.has(pkg) ? `${pkg} (${bumps.get(pkg)})` : pkg))} in the next release`)
  }
  const deploys = COMPONENTS.filter(c => c.deploys && entries.some(e => e.component === c && !e.test))
  if (deploys.length > 0) parts.push(`deploys ${joinNames(deploys.map(c => c.deploys))}`)
  const workflows = findings.filter(f => f.entry && isWorkflow(f.entry.path))
  if (workflows.some(f => f.level === 4)) parts.push('changes the npm publish workflow')
  else if (workflows.length > 0) parts.push('changes CI workflows')
  return parts.length > 0 ? `On merge: ${parts.join('; ')}` : 'On merge: nothing ships or deploys'
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
  const rows = assessment.areas
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
