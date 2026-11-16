/**
 * Record pull requests as calibration fixtures for `calibration.test.mjs`:
 *
 *   pnpm risk-score:record 1076 1059
 *
 * Reads each pull request with the `gh` CLI, the same data the workflow reads
 * from the API, and writes `fixtures/<number>.json`. Patches are kept only
 * where a rule reads them, and manifests only keep the fields that differ, so
 * the fixtures stay small without changing their score.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { isManifest } from './lib.mjs'

const REPO = 'evloghq/evlog'
const gh = (...args) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
const readJson = (path, ref) => JSON.parse(gh('-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/${path}?ref=${ref}`))

// Tests and docs score the same with or without their patch.
const patchMatters = path => /\.([cm]?[jt]sx?|vue|sql)$/.test(path) && !/(^|\/)(test|tests|__tests__|evals)\/|\.(test|spec|eval)\.[cm]?[jt]sx?$/.test(path)
  || /^(\.changeset\/.+\.(md|json)|\.github\/(workflows|actions)\/)/.test(path)

/** Drop the fields both sides share: they never change a classification. */
function differing(base, head) {
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(head ?? {})])
  const pick = side => side && Object.fromEntries([...keys].filter(k => k === 'name' || JSON.stringify(base?.[k]) !== JSON.stringify(head?.[k])).filter(k => k in side).map(k => [k, side[k]]))
  return { base: pick(base), head: pick(head) }
}

for (const number of process.argv.slice(2)) {
  const pr = JSON.parse(gh(`repos/${REPO}/pulls/${number}`))
  const files = JSON.parse(gh('--paginate', '--slurp', `repos/${REPO}/pulls/${number}/files?per_page=100`)).flat()
  const { merge_base_commit } = JSON.parse(gh(`repos/${REPO}/compare/${pr.base.sha}...${pr.head.sha}`))
  const manifests = {}
  for (const f of files.filter(f => isManifest(f.filename))) {
    const base = f.status === 'added' ? null : readJson(f.previous_filename ?? f.filename, merge_base_commit.sha)
    const head = f.status === 'removed' ? null : readJson(f.filename, pr.head.sha)
    manifests[f.filename] = differing(base, head)
  }
  const fixture = {
    number: pr.number,
    title: pr.title,
    author: { login: pr.user.login, fork: pr.head.repo?.full_name !== pr.base.repo.full_name, association: pr.author_association },
    files: files.map(({ filename, status, additions, deletions, patch, previous_filename }) => ({
      filename, status, additions, deletions, previous_filename, patch: patchMatters(filename) ? patch : undefined,
    })),
    manifests,
  }
  writeFileSync(new URL(`fixtures/${number}.json`, import.meta.url), `${JSON.stringify(fixture, null, 1)}\n`)
  console.log(`fixtures/${number}.json`)
}
