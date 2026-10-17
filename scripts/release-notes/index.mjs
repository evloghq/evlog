/**
 * Rewrite each published package's GitHub release body, then pin the Latest
 * badge to `evlog`.
 *
 * ## Why this exists
 *
 * `createGithubReleases: true` gives changesets' own body — the CHANGELOG
 * section. For a dependent package that reads:
 *
 *     ### Patch Changes
 *     - Updated dependencies [[`f39ab30`](…), [`899464a`](…), [`d7f482a`](…), …]
 *       - evlog@2.23.0
 *
 * ...which says nothing a reader can use, and packages with no changeset of
 * their own get an empty release.
 *
 * The obvious alternative, `gh release create --generate-notes`, has the
 * opposite problem: GitHub builds those notes from a commit *range*, and in a
 * monorepo the per-package tags interleave. The range between two consecutive
 * `@evlog/cli` tags sweeps up every core / telemetry / docs PR that landed in
 * between, so each package's notes list everybody's work.
 *
 * So we build the list ourselves: the PRs whose commits touched the package's
 * directory since its previous tag, plus every PR a changeset in this version
 * came from, grouped with the same label → category mapping GitHub uses. A PR
 * that ships changesets is listed once per changeset, in the changeset's own
 * words, so a PR that fixes two things shows two lines instead of one title.
 *
 * GitHub gives the Latest badge to the release created last, and changesets
 * creates one per package, so a run that also publishes `@evlog/cli` would
 * leave the CLI as Latest. The last step marks the newest stable `evlog`
 * release Latest on every run.
 *
 * ## Usage
 *
 *     node scripts/release-notes/index.mjs '[{"name":"evlog","version":"2.24.0"}]'
 *
 * Rehearse it without editing anything, on a version that is already tagged:
 *
 *     GITHUB_TOKEN=$(gh auth token) DRY_RUN=1 \
 *       node scripts/release-notes/index.mjs '[{"name":"evlog","version":"2.24.0"}]'
 *
 * Before the tag exists, check out the version packages PR branch and add
 * `RELEASE_NOTES_REF=HEAD`.
 *
 * ## Env
 *
 * - `GITHUB_TOKEN`       required, used for the PR lookups and `gh release edit`
 * - `GITHUB_REPOSITORY`  owner/repo (set by Actions; falls back to the git remote)
 * - `DRY_RUN=1`          print the notes instead of editing the releases
 * - `RELEASE_NOTES_REF`  end of the commit range (default: the release tag)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  changelogSection,
  changesetEntries,
  isExcluded,
  latestStableTag,
  parseReleaseConfig,
  renderNotes,
} from './lib.mjs'

const LATEST_PACKAGE = 'evlog'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

function resolveRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  const url = git('remote', 'get-url', 'origin')
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/)
  if (!match) throw new Error(`cannot derive owner/repo from remote "${url}"`)
  return match[1]
}

/** Map every workspace package name to its directory. */
function packageDirs() {
  const root = resolve(process.cwd(), 'packages')
  const out = new Map()
  for (const entry of readdirSync(root)) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(root, entry, 'package.json'), 'utf8'))
      if (pkg.name) out.set(pkg.name, `packages/${entry}`)
    } catch {
      // not a package directory
    }
  }
  return out
}

/**
 * The tag this package was released under last time.
 *
 * Falls back to the newest `v*` tag from before the repo moved to per-package
 * tags, so an early per-package release still gets a bounded range instead of
 * the entire history.
 */
function previousTag(name, currentTag, head) {
  const scoped = git('tag', '--list', `${name}@*`, '--merged', head, '--sort=-creatordate')
    .split('\n')
    .filter(t => t && t !== currentTag)
  if (scoped.length > 0) return scoped[0]

  const legacy = git('tag', '--list', 'v*', '--merged', head, '--sort=-creatordate').split('\n').filter(Boolean)
  return legacy[0] ?? null
}

/** Commits in (from, to] that touched the package directory. */
function commitsTouching(dir, from, to) {
  const range = from ? `${from}..${to}` : to
  const out = git('log', range, '--format=%H', '--no-merges', '--', dir)
  return out ? out.split('\n').filter(Boolean) : []
}

/** The CHANGELOG as of `ref`, so a rehearsal reads the same file the tag holds. */
function changelogAt(ref, dir) {
  return git('show', `${ref}:${dir}/CHANGELOG.md`)
}

async function github(repo, path, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  // A missing line in a release is worse than a failed job someone can rerun.
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`)
  return await res.json()
}

const toPull = pr => ({
  number: pr.number,
  title: pr.title,
  author: pr.user?.login ?? 'unknown',
  labels: (pr.labels ?? []).map(l => l.name),
})

async function collectPulls({ repo, token, config, shas, changesetPulls }) {
  // One PR can carry several commits; keep first-seen order (newest first).
  const seen = new Map()
  const add = (pr) => {
    if (!pr.merged_at || seen.has(pr.number)) return
    const pull = toPull(pr)
    if (!isExcluded(pull, config)) seen.set(pr.number, pull)
  }

  for (const sha of shas) {
    for (const pr of await github(repo, `commits/${sha}/pulls`, token)) add(pr)
  }
  // A changeset can bump a package from a PR that never touched its directory.
  for (const number of changesetPulls) {
    if (!seen.has(number)) add(await github(repo, `pulls/${number}`, token))
  }
  return [...seen.values()]
}

function ghRelease(args, token) {
  execFileSync('gh', ['release', 'edit', ...args], {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: token },
  })
}

async function main() {
  const raw = process.argv[2]
  if (!raw) throw new Error('usage: release-notes/index.mjs \'[{"name":"evlog","version":"1.0.0"}]\'')

  const published = JSON.parse(raw)
  if (!Array.isArray(published) || published.length === 0) {
    console.log('[release-notes] nothing published, skipping')
    return
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is required')
  const repo = resolveRepo()
  const dirs = packageDirs()
  const config = parseReleaseConfig(readFileSync(resolve(process.cwd(), '.github/release.yml'), 'utf8'))
  const dryRun = process.env.DRY_RUN === '1'

  // Build every body before editing any, so a failed lookup leaves no release half-updated.
  const releases = []
  for (const { name, version } of published) {
    const tag = `${name}@${version}`
    const dir = dirs.get(name)
    if (!dir) throw new Error(`no directory for ${name}`)

    const head = process.env.RELEASE_NOTES_REF ?? tag
    const previous = previousTag(name, tag, head)
    const section = changelogSection(changelogAt(head, dir), version)
    if (section === null) throw new Error(`${dir}/CHANGELOG.md has no ## ${version} section at ${head}`)
    const entries = changesetEntries(section)
    const pulls = await collectPulls({
      repo,
      token,
      config,
      shas: commitsTouching(dir, previous, head),
      changesetPulls: [...new Set(entries.map(e => e.pr).filter(Boolean))],
    })
    const changelog = { path: `${dir}/CHANGELOG.md`, version }
    const notes = renderNotes({ repo, pulls, entries, previous, tag, config, changelog })
    console.log(`\n── ${tag}  (${pulls.length} PR${pulls.length === 1 ? '' : 's'} since ${previous ?? 'repo start'})`)
    releases.push({ tag, notes })
  }

  for (const { tag, notes } of releases) {
    if (dryRun) {
      console.log(`\n${tag}\n${notes}`)
      continue
    }
    ghRelease([tag, '--notes', notes], token)
    console.log(`[release-notes] updated ${tag}`)
  }

  const latest = latestStableTag(git('tag', '--list', `${LATEST_PACKAGE}@*`).split('\n'), LATEST_PACKAGE)
  if (!latest) throw new Error(`no stable ${LATEST_PACKAGE} tag to mark Latest`)
  if (dryRun) {
    console.log(`\n[release-notes] would mark ${latest} as Latest`)
    return
  }
  ghRelease([latest, '--latest'], token)
  console.log(`[release-notes] marked ${latest} as Latest`)
}

await main()
