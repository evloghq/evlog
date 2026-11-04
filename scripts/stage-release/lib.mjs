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
      `Approve each one with the command above or from the Staged packages tab on npmjs.com. This job waits ${windowMinutes} minutes, then tags every approved version and creates its GitHub release. For a version approved later, run ${rerun}.`,
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
