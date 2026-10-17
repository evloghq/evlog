/**
 * Pure helpers for `index.mjs`: no git, no network, so they can be tested on
 * fixtures.
 */

/**
 * Read the categories and exclusions out of `.github/release.yml`. Minimal
 * parse: the file is a fixed shape we own, and this avoids a YAML dependency
 * in CI.
 */
export function parseReleaseConfig(text) {
  const categories = []
  const excludedLabels = []
  const excludedAuthors = []
  let section = null      // 'exclude' | 'categories'
  let excludeKey = null   // 'labels' | 'authors' — they are separate lists
  let current = null

  for (const line of text.split('\n')) {
    if (/^\s{2}exclude:/.test(line)) { section = 'exclude'; excludeKey = null; continue }
    if (/^\s{2}categories:/.test(line)) { section = 'categories'; continue }
    if (section === 'exclude') {
      if (/^\s*labels:/.test(line)) { excludeKey = 'labels'; continue }
      if (/^\s*authors:/.test(line)) { excludeKey = 'authors'; continue }
    }

    const title = line.match(/^\s*-\s*title:\s*(.+?)\s*$/)
    if (title && section === 'categories') {
      current = { title: title[1], labels: [] }
      categories.push(current)
      continue
    }
    const item = line.match(/^\s*-\s*(\S.*?)\s*$/)
    if (item && !line.includes(':')) {
      if (section === 'categories' && current) current.labels.push(item[1])
      else if (section === 'exclude' && excludeKey === 'labels') excludedLabels.push(item[1])
      else if (section === 'exclude' && excludeKey === 'authors') excludedAuthors.push(item[1])
    }
  }
  return { categories, excludedLabels, excludedAuthors }
}

/** Whether a pull request is left out of the notes by `.github/release.yml`. */
export function isExcluded(pr, config) {
  return config.excludedAuthors.includes(pr.author)
    || pr.labels.some(l => config.excludedLabels.includes(l))
}

const parseVersion = v => v.split('.').map(Number)

/**
 * The newest stable `<name>@x.y.z` tag. Prereleases are skipped: GitHub never
 * marks them Latest.
 */
export function latestStableTag(tags, name) {
  const prefix = `${name}@`
  const stable = tags
    .filter(t => t.startsWith(prefix) && /^\d+\.\d+\.\d+$/.test(t.slice(prefix.length)))
    .map(t => ({ tag: t, version: parseVersion(t.slice(prefix.length)) }))
  stable.sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2])
  return stable[0]?.tag ?? null
}

/** The body of the `## <version>` section of a changesets CHANGELOG, or `null`. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${version}`)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => l.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

/**
 * Split a section into `### Minor Changes`-style groups of entries. An entry is
 * a top-level `- ` bullet with every indented or blank line under it.
 */
function changelogGroups(section) {
  const groups = []
  let group = null
  let entry = null
  for (const line of section.split('\n')) {
    if (line.startsWith('### ')) {
      group = { heading: line.slice(4).trim(), entries: [] }
      groups.push(group)
      entry = null
    }
    else if (line.startsWith('- ') && group) {
      entry = [line]
      group.entries.push(entry)
    }
    else if (entry) {
      entry.push(line)
    }
  }
  return groups.map(g => ({ heading: g.heading, entries: g.entries.map(e => e.join('\n').trimEnd()) }))
}

const DEPENDENCY_ENTRY = /^- Updated dependencies\b/
// `@changesets/changelog-github` prefixes each summary with the PR, the commit and the authors.
const ENTRY_PREFIX = /^- (?:\[#(\d+)\]\([^)]*\) )?(?:\[`[0-9a-f]+`\]\([^)]*\) )?(?:Thanks .*?! )?- /

/**
 * One entry per changeset in a section, in CHANGELOG order: the PR it came
 * from (`null` without one), its bump and its summary. A PR with two
 * changesets gives two entries. "Updated dependencies" entries are left out.
 */
export function changesetEntries(section) {
  const out = []
  for (const { heading, entries } of changelogGroups(section)) {
    const bump = heading.split(' ')[0].toLowerCase()
    for (const entry of entries) {
      if (DEPENDENCY_ENTRY.test(entry)) continue
      const match = entry.match(ENTRY_PREFIX)
      const summary = (match ? entry.slice(match[0].length) : entry.slice(2))
        .split('\n')
        .map(l => l.replace(/^ {2}/, ''))
        .join('\n')
        .trim()
      out.push({ pr: match?.[1] ? Number(match[1]) : null, bump, summary })
    }
  }
  return out
}

/**
 * The first sentence of a changeset summary, for a one-line release entry.
 * A colon also ends it, since the summaries put the detail after one. A
 * period or colon inside a code span, a period in "e.g." and "i.e.", and a
 * leading label such as "Breaking:" do not.
 */
export function headline(summary) {
  const text = summary.split(/\n\s*\n/)[0].replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()
  let inCode = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') inCode = !inCode
    if (inCode || (text[i] !== '.' && text[i] !== ':') || (i + 1 < text.length && text[i + 1] !== ' ')) continue
    if (text[i] === '.' && /\b(?:e\.g|i\.e)$/.test(text.slice(0, i))) continue
    if (text[i] === ':' && !text.slice(0, i).includes(' ')) continue
    return text.slice(0, i)
  }
  return text.replace(/\.$/, '')
}

/**
 * The release label a changeset entry is filed under. The bump says what the
 * change is: a patch changeset in a `feat` PR is a fix, and a minor one in a
 * `fix` PR is a feature. A patch keeps its PR's label when that is a release
 * category narrower than a fix, such as `performance`; any other label, such
 * as one set by hand, is ignored.
 */
function entryLabel(bump, prLabels, categoryLabels) {
  if (bump === 'major') return 'breaking'
  if (bump === 'minor') return 'feature'
  return prLabels.find(l => categoryLabels.has(l) && !['breaking', 'feature', 'enhancement'].includes(l)) ?? 'bug'
}

/** GitHub's heading anchor for a `## <version>` line. */
const versionAnchor = version => version.toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-')

/**
 * Render in GitHub's own shape, so the list reads like a generated release.
 * Each changeset is its own line, worded by its summary; a PR without a
 * changeset in this version is listed by its title.
 */
export function renderNotes({ repo, pulls, entries = [], previous, tag, config, changelog }) {
  const items = []
  const byPull = new Map(pulls.map(p => [p.number, p]))
  const categoryLabels = new Set(config.categories.flatMap(c => c.labels))
  for (const pull of pulls) {
    const own = entries.filter(e => e.pr === pull.number)
    if (own.length === 0) items.push({ text: pull.title, labels: pull.labels, pull })
    for (const e of own) items.push({ text: headline(e.summary), labels: [entryLabel(e.bump, pull.labels, categoryLabels)], pull })
  }
  for (const e of entries.filter(e => !byPull.has(e.pr))) {
    items.push({ text: headline(e.summary), labels: [entryLabel(e.bump, [], categoryLabels)], pull: null })
  }

  const line = ({ text, pull }) => pull
    ? `* ${text} by @${pull.author} in https://github.com/${repo}/pull/${pull.number}`
    : `* ${text}`
  const remaining = new Set(items)
  const sections = []

  for (const category of config.categories) {
    const matched = items.filter(i => remaining.has(i) && i.labels.some(l => category.labels.includes(l)))
    if (matched.length === 0) continue
    for (const i of matched) remaining.delete(i)
    sections.push(`### ${category.title}\n${matched.map(line).join('\n')}`)
  }

  // GitHub files anything unlabelled under "Other Changes".
  const others = items.filter(i => remaining.has(i))
  if (others.length > 0) sections.push(`### Other Changes 🔨\n${others.map(line).join('\n')}`)

  const parts = [
    sections.length > 0
      ? `## What's Changed\n${sections.join('\n')}`
      : `## What's Changed\n_No pull requests touched this package in this release._`,
  ]
  const footer = []
  if (changelog && entries.length > 0) {
    footer.push(`**Changelog**: https://github.com/${repo}/blob/${tag}/${changelog.path}#${versionAnchor(changelog.version)}`)
  }
  if (previous) footer.push(`**Full Changelog**: https://github.com/${repo}/compare/${previous}...${tag}`)
  if (footer.length > 0) parts.push(footer.join('\n'))
  return parts.join('\n\n')
}
