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
 * 1. A version on npm without a tag, approved after an earlier run stopped
 *    waiting, gets its tag on the commit that set the version.
 * 2. A version that changed in this push, or any version missing from npm when
 *    the run was started by hand, is packed with `pnpm pack` (which resolves
 *    `workspace:` ranges the way `pnpm publish` does) and staged with the
 *    dist-tag `changeset publish` would use.
 * 3. The run waits for the staged versions to be approved, then tags them on HEAD.
 *
 * A push never stages a version an earlier run already staged, so an
 * unapproved version is not staged again on every merge.
 *
 * ## Env
 *
 * - `RELEASE_BASE`         the commit before the push (`github.event.before`), empty when started by hand
 * - `GITHUB_REF_NAME`      the branch, for the instructions in the job summary
 * - `GITHUB_STEP_SUMMARY`  where the approval instructions go, when set
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { approvalSummary, distTag, idOf, plan, REGISTRY, stageIdFrom } from './lib.mjs'

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
    .map(pkg => ({ name: pkg.name, version: pkg.version, dir: relative(process.cwd(), pkg.path) }))
}

/** Every version of `name` on npm, or none when the package does not exist yet. */
async function npmVersions(name) {
  const res = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GET ${name} from npm failed: ${res.status} ${await res.text()}`)
  return Object.keys((await res.json()).versions)
}

function versionAt(commit, dir) {
  const file = `${dir}/package.json`
  if (!git('ls-tree', '--name-only', commit, '--', file)) return undefined
  return JSON.parse(git('show', `${commit}:${file}`)).version
}

/** Each package's version before the push, or `null` for a run started by hand. */
function previousVersions(packages) {
  const base = process.env.RELEASE_BASE
  // A push that creates the branch has no previous commit and reports zeros.
  if (!base || /^0+$/.test(base)) return null
  git('cat-file', '-e', `${base}^{commit}`)
  return new Map(packages.map(pkg => [pkg.name, versionAt(base, pkg.dir)]))
}

/** The commit that set the package's current version, where its release tag belongs. */
function versionCommit(pkg) {
  const commit = git('log', '-1', '--format=%H', `-S"version": "${pkg.version}"`, '--', `${pkg.dir}/package.json`)
  if (!commit) throw new Error(`no commit sets ${pkg.dir}/package.json to ${pkg.version}`)
  return commit
}

function stage(pkg, tag, destination) {
  const { filename } = JSON.parse(run('pnpm', ['pack', '--pack-destination', destination, '--json'], { cwd: pkg.dir }))
  const args = ['stage', 'publish', filename, '--tag', tag, '--access', 'public', '--registry', `${REGISTRY}/`, '--json']
  const stageId = stageIdFrom(run('npm', args), pkg.name)
  console.error(`Staged ${idOf(pkg)} with the ${tag} tag, stage ${stageId}`)
  return { ...pkg, tag, stageId }
}

async function waitForApproval(staged) {
  const deadline = Date.now() + APPROVAL_WINDOW_MINUTES * 60_000
  const approved = []
  let pending = staged
  while (pending.length > 0 && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const live = await Promise.all(pending.map(async pkg => (await npmVersions(pkg.name)).includes(pkg.version)))
    for (const [index, pkg] of pending.entries()) {
      if (!live[index]) continue
      approved.push(pkg)
      console.error(`${idOf(pkg)} is on npm`)
    }
    pending = pending.filter((_, index) => !live[index])
  }
  return { approved, pending }
}

const packages = workspacePackages()
const preState = existsSync('.changeset/pre.json') ? JSON.parse(readFileSync('.changeset/pre.json', 'utf8')) : undefined
const versions = new Map(await Promise.all(packages.map(async pkg => [pkg.name, await npmVersions(pkg.name)])))

const { release, stage: toStage, waiting } = plan(packages, {
  published: new Set(packages.filter(pkg => versions.get(pkg.name).includes(pkg.version)).map(idOf)),
  tagged: new Set(packages.map(idOf).filter(id => git('tag', '--list', id) === id)),
  previousVersions: previousVersions(packages),
})

const destination = mkdtempSync(join(tmpdir(), 'evlog-stage-'))
const staged = toStage.map(pkg => stage(pkg, distTag(preState, versions.get(pkg.name)), destination))

const branch = process.env.GITHUB_REF_NAME
const summary = approvalSummary({ staged, waiting, branch, windowMinutes: APPROVAL_WINDOW_MINUTES })
if (summary) {
  console.error(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
}
for (const pkg of waiting) {
  console.log(`::warning::${idOf(pkg)} is staged and waiting for approval. Once approved, run release.yml on ${branch} again to tag and release it.`)
}

const { approved, pending } = await waitForApproval(staged)

for (const [pkg, commit] of [...release.map(pkg => [pkg, versionCommit(pkg)]), ...approved.map(pkg => [pkg, 'HEAD'])]) {
  git('tag', idOf(pkg), '-m', idOf(pkg), commit)
  console.log(`New tag: ${idOf(pkg)}`)
}
for (const pkg of pending) {
  console.log(`::warning::${idOf(pkg)} was not approved within ${APPROVAL_WINDOW_MINUTES} minutes (stage ${pkg.stageId}). Once approved, run release.yml on ${branch} again to tag and release it.`)
}
