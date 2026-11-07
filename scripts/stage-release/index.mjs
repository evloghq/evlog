/**
 * Stage each new package version on npm, then tag and release the ones a
 * maintainer approves.
 *
 * ## Why this exists
 *
 * npm's trusted publishers for evlog's packages only allow staging. A staged
 * version reaches npm once a maintainer approves it with 2FA, from
 * `npm stage approve` or npmjs.com, so a run of `release.yml` cannot ship a
 * version on its own. `changeset publish` publishes directly, so it is not used.
 *
 * `changesets/action` runs this as its publish command, and creates a tag and a
 * GitHub release for each `New tag: <name>@<version>` line on stdout. This prints
 * that line only for a version that is on npm. Everything else goes to stderr.
 *
 * ## What a run does
 *
 * 1. A version on npm without a release tag, approved after an earlier run stopped
 *    waiting, gets its tag on the commit it was packed from.
 * 2. A version missing from npm that no run staged, or any version missing from npm
 *    when the run was started by hand, is packed with `pnpm pack` (which resolves
 *    `workspace:` ranges the way `pnpm publish` does) and staged with the dist-tag
 *    `changeset publish` would use.
 * 3. The run waits for the staged versions to be approved, and tags each one on
 *    HEAD as soon as it is on npm.
 *
 * Every tag is created as soon as its version is on npm, so an error later in the
 * run, a failed stage or a failed poll, does not drop it.
 *
 * ## Staged tags
 *
 * The release job has no npm token: `npm stage publish` authenticates through the
 * trusted publisher, and `npm stage list` cannot. So right after a version is
 * staged, the run pushes a `staged/<name>@<version>` tag on the commit it packed.
 * A later run reads it to know the version is already staged, instead of staging
 * it again on every push, and tags the release on that commit. The run deletes it
 * once the version is released.
 *
 * A version whose run failed before `npm stage publish` has no staged tag, so the
 * next run stages it.
 *
 * ## Workspace dependencies
 *
 * A package that pins another workspace package (`@evlog/cli` pins
 * `@evlog/telemetry`) is not staged while that version is missing from npm:
 * approved first, it would require a version that cannot be installed. The run
 * stages it as soon as one of its polls finds the dependency on npm.
 *
 * ## Env
 *
 * - `GITHUB_EVENT_NAME`    `workflow_dispatch` for a run started by hand
 * - `GITHUB_REF_NAME`      the branch, for the instructions in the job summary
 * - `GITHUB_STEP_SUMMARY`  where the approval instructions go, when set
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  approvalSummary,
  distTag,
  idOf,
  missingDependencies,
  plan,
  REGISTRY,
  stagedTable,
  stagedTagOf,
  stageIdFrom,
  waitForApproval,
  workspaceDependencies,
} from './lib.mjs'

const APPROVAL_WINDOW_MINUTES = 30
const POLL_INTERVAL_MS = 20_000

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim()
const git = (...args) => run('git', args)

/** The packages `changeset publish` would consider: every non-private workspace package. */
function workspacePackages() {
  const all = JSON.parse(run('pnpm', ['-r', 'ls', '--depth', '-1', '--json']))
  return all
    .filter(pkg => !pkg.private)
    .map((pkg) => {
      const manifest = JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'))
      return {
        name: pkg.name,
        version: pkg.version,
        dir: relative(process.cwd(), pkg.path),
        workspaceDependencies: workspaceDependencies(manifest),
      }
    })
}

/** Every version of `name` on npm, or none when the package does not exist yet. */
async function npmVersions(name) {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GET ${name} from npm failed: ${res.status} ${await res.text()}`)
  return Object.keys((await res.json()).versions)
}

const hasTag = name => git('tag', '--list', name) === name

/** The commit a version on npm was packed from: its staged tag, or the commit that set the version. */
function packedCommit(pkg) {
  if (hasTag(stagedTagOf(pkg))) return git('rev-parse', `${stagedTagOf(pkg)}^{commit}`)
  const commit = git('log', '-1', '--format=%H', `-S"version": "${pkg.version}"`, '--', `${pkg.dir}/package.json`)
  if (!commit) throw new Error(`no commit sets ${pkg.dir}/package.json to ${pkg.version}`)
  return commit
}

function stage(pkg, tag, destination) {
  const { filename } = JSON.parse(run('pnpm', ['pack', '--pack-destination', destination, '--json'], { cwd: pkg.dir }))
  const args = ['stage', 'publish', filename, '--tag', tag, '--access', 'public', '--registry', `${REGISTRY}/`, '--json']
  const stageId = stageIdFrom(run('npm', args), pkg.name)
  console.error(`Staged ${idOf(pkg)} with the ${tag} tag, stage ${stageId}`)
  // A run started by hand stages a version again from a later commit, so the tag moves with it.
  const ref = `refs/tags/${stagedTagOf(pkg)}`
  git('tag', '--force', stagedTagOf(pkg), 'HEAD')
  git('push', 'origin', `+${ref}:${ref}`)
  return { ...pkg, tag, stageId }
}

function release(pkg, commit) {
  git('tag', idOf(pkg), '-m', idOf(pkg), commit)
  console.log(`New tag: ${idOf(pkg)}`)
  if (!hasTag(stagedTagOf(pkg))) return
  git('tag', '--delete', stagedTagOf(pkg))
  git('push', 'origin', `:refs/tags/${stagedTagOf(pkg)}`)
}

const packages = workspacePackages()
const preState = existsSync('.changeset/pre.json') ? JSON.parse(readFileSync('.changeset/pre.json', 'utf8')) : undefined
const versions = new Map(await Promise.all(packages.map(async pkg => [pkg.name, await npmVersions(pkg.name)])))
const published = new Set(packages.filter(pkg => versions.get(pkg.name).includes(pkg.version)).map(idOf))

const { release: toRelease, stage: toStage, waiting } = plan(packages, {
  published,
  tagged: new Set(packages.map(idOf).filter(hasTag)),
  staged: new Set(packages.filter(pkg => hasTag(stagedTagOf(pkg))).map(idOf)),
  manual: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch',
})

for (const pkg of toRelease) release(pkg, packedCommit(pkg))

const destination = mkdtempSync(join(tmpdir(), 'evlog-stage-'))
const stageWithTag = pkg => stage(pkg, distTag(preState, versions.get(pkg.name)), destination)
const isReady = pkg => missingDependencies(pkg, packages, published).length === 0

let blocked = toStage.filter(pkg => !isReady(pkg))
const staged = toStage.filter(isReady).map(stageWithTag)

const branch = process.env.GITHUB_REF_NAME
const writeSummary = (text) => {
  console.error(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
}
const summary = approvalSummary({
  staged,
  waiting,
  blocked: blocked.map(pkg => ({ pkg, missing: missingDependencies(pkg, packages, published) })),
  branch,
  windowMinutes: APPROVAL_WINDOW_MINUTES,
})
if (summary) writeSummary(summary)
for (const pkg of waiting) {
  console.log(`::warning::${idOf(pkg)} is staged and waiting for approval. Once approved, run release.yml on ${branch} again to tag and release it.`)
}

const pending = await waitForApproval(staged, {
  isLive: async pkg => (await npmVersions(pkg.name)).includes(pkg.version),
  onApproved: (pkg) => {
    console.error(`${idOf(pkg)} is on npm`)
    published.add(idOf(pkg))
    release(pkg, 'HEAD')
  },
  stageUnblocked: () => {
    const ready = blocked.filter(isReady)
    if (ready.length === 0) return []
    blocked = blocked.filter(pkg => !isReady(pkg))
    const unblocked = ready.map(stageWithTag)
    writeSummary(`### Staged once its dependencies were on npm\n\n${stagedTable(unblocked)}\n`)
    return unblocked
  },
  sleep: () => sleep(POLL_INTERVAL_MS),
  deadline: Date.now() + APPROVAL_WINDOW_MINUTES * 60_000,
})

for (const pkg of pending) {
  console.log(`::warning::${idOf(pkg)} was not approved within ${APPROVAL_WINDOW_MINUTES} minutes (stage ${pkg.stageId}). Once approved, run release.yml on ${branch} again to tag and release it.`)
}
for (const pkg of blocked) {
  const missing = missingDependencies(pkg, packages, published).map(idOf).join(', ')
  console.log(`::warning::${idOf(pkg)} was not staged: it pins ${missing}, which is not on npm. Once it is, run release.yml on ${branch} again to stage ${idOf(pkg)}.`)
}
