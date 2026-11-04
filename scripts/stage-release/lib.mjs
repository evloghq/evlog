export const REGISTRY = 'https://registry.npmjs.org'

/** `name@version`, the form of a release tag and of a stage. */
export const idOf = pkg => `${pkg.name}@${pkg.version}`

/** `3.0.0-beta.1` → `beta`; `undefined` for a regular release. */
function prereleaseId(version) {
  return /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version)?.[1]
}

/**
 * The dist-tag a version goes out under, picked the way `changeset publish` picks it:
 * the pre-mode tag on a prerelease branch, except for a package with no regular
 * release yet, which gets `latest` so that installing it without a tag works.
 *
 * @param {{ mode: string, tag: string } | undefined} preState `.changeset/pre.json`, when present
 * @param {string[]} publishedVersions every version of the package on npm
 * @returns {string}
 */
export function distTag(preState, publishedVersions) {
  if (preState?.mode !== 'pre') return 'latest'
  return publishedVersions.every(version => prereleaseId(version) === preState.tag) ? 'latest' : preState.tag
}

/**
 * @typedef {{ name: string, version: string, dir: string }} WorkspacePackage
 */

/**
 * Sort each public package into what this run does with it.
 *
 * - `release`: on npm but not tagged, so it was approved after an earlier run stopped waiting.
 * - `stage`: not on npm, and its version changed in this push, or the run was started by hand.
 * - `waiting`: not on npm, and an earlier run already staged this version.
 *
 * A version on npm with its tag is left out.
 *
 * @param {WorkspacePackage[]} packages
 * @param {object} state
 * @param {Set<string>} state.published `name@version` of the versions already on npm
 * @param {Set<string>} state.tagged `name@version` of the versions with a git tag
 * @param {Map<string, string | undefined> | null} state.previousVersions each package's version before the push, `null` for a run started by hand
 */
export function plan(packages, { published, tagged, previousVersions }) {
  const out = { release: [], stage: [], waiting: [] }
  for (const pkg of packages) {
    const id = idOf(pkg)
    if (published.has(id)) {
      if (!tagged.has(id)) out.release.push(pkg)
      continue
    }
    const isNew = previousVersions === null || previousVersions.get(pkg.name) !== pkg.version
    out[isNew ? 'stage' : 'waiting'].push(pkg)
  }
  return out
}

/**
 * Poll until every staged version is on npm or the deadline passes, and hand each one
 * to `onApproved` as soon as it is seen. A poll that fails still reports the versions
 * the same poll found, then throws.
 *
 * @param {WorkspacePackage[]} staged
 * @param {object} options
 * @param {(pkg: WorkspacePackage) => Promise<boolean>} options.isLive whether the version is on npm
 * @param {(pkg: WorkspacePackage) => void} options.onApproved
 * @param {() => Promise<void>} options.sleep the wait before each poll
 * @param {number} options.deadline
 * @param {() => number} [options.now]
 * @returns {Promise<WorkspacePackage[]>} the versions still pending at the deadline
 */
export async function waitForApproval(staged, { isLive, onApproved, sleep, deadline, now = Date.now }) {
  let pending = staged
  while (pending.length > 0 && now() < deadline) {
    await sleep()
    const results = await Promise.allSettled(pending.map(isLive))
    const stillPending = []
    for (const [index, pkg] of pending.entries()) {
      if (results[index].status === 'fulfilled' && results[index].value) onApproved(pkg)
      else stillPending.push(pkg)
    }
    pending = stillPending
    const failed = results.find(result => result.status === 'rejected')
    if (failed) throw failed.reason
  }
  return pending
}

/** The stage id in `npm stage publish --json` output, which is keyed by package name. */
export function stageIdFrom(stdout, name) {
  const stageId = JSON.parse(stdout)[name]?.stageId
  if (!stageId) throw new Error(`npm stage publish printed no stage id for ${name}:\n${stdout}`)
  return stageId
}

/**
 * The job summary: what to approve, and how to finish a release once it is approved.
 *
 * @param {object} input
 * @param {Array<WorkspacePackage & { tag: string, stageId: string }>} input.staged
 * @param {WorkspacePackage[]} input.waiting
 * @param {string} input.branch
 * @param {number} input.windowMinutes
 */
export function approvalSummary({ staged, waiting, branch, windowMinutes }) {
  const rerun = `\`gh workflow run release.yml --ref ${branch}\``
  const lines = []
  if (staged.length > 0) {
    lines.push(
      '### Staged on npm',
      '',
      '| Version | Dist-tag | Approve with 2FA |',
      '| --- | --- | --- |',
      ...staged.map(pkg => `| \`${idOf(pkg)}\` | \`${pkg.tag}\` | \`npm stage approve ${pkg.stageId} --registry=${REGISTRY}/\` |`),
      '',
      `Approve each one with the command above or from the Staged packages tab on npmjs.com. This job waits up to ${windowMinutes} minutes and tags each version once it is approved; the GitHub releases are created when the wait ends. For a version approved later, run ${rerun}.`,
      '',
      `Approve only the newest stage of a package, and reject any older one still pending (\`npm stage list <package> --registry=${REGISTRY}/\`, then \`npm stage reject <id> --registry=${REGISTRY}/\`). An older stage approved after a newer one moves the dist-tag back to the older version.`,
      '',
    )
  }
  if (waiting.length > 0) {
    lines.push(
      '### Waiting for approval',
      '',
      ...waiting.map(pkg => `- \`${idOf(pkg)}\``),
      '',
      `An earlier run staged these. Approve them, then run ${rerun} to tag them and create their GitHub releases. To stage a rejected version again, run the same command.`,
      '',
    )
  }
  return lines.join('\n')
}
