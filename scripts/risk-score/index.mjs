/**
 * Score a pull request and publish the result as a Linear `riskScore` in a
 * sticky comment, bound to the head commit SHA.
 *
 * Runs from `.github/workflows/risk-score.yml` through `actions/github-script`,
 * which passes an authenticated Octokit and the event context. The score is
 * computed by the rules in `lib.mjs` from the file list, patches, title and
 * package manifests the GitHub API returns; no code from the pull request is
 * checked out or executed.
 *
 * Linear reads the `<!-- linear:extension ... -->` block once the repository is
 * connected through the Linear GitHub integration with code access. No secret
 * beyond the workflow's `GITHUB_TOKEN` is needed.
 *
 * Format and validation rules: https://linear.app/docs/diffs#risk-score
 */
import { assessRisk, COMMENT_MARKER, isManifest, LEVELS, renderComment } from './lib.mjs'

/**
 * Assess the pull request in `context` and create or update its risk score comment.
 *
 * @param {{ github: object, context: object, core: object }} args the `actions/github-script` globals
 */
export async function publishRiskScore({ github, context, core }) {
  const pull_number = context.payload.pull_request.number
  // The payload is a snapshot from when the event fired; a later push or title edit may already be applied.
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number })
  const files = await github.paginate(github.rest.pulls.listFiles, { ...context.repo, pull_number, per_page: 100 })

  // Manifests are scored by which fields changed, so read both sides. The file list diffs against the merge base,
  // not `pr.base.sha`. The PR head is readable from this repository by SHA, fork PRs included.
  const manifests = {}
  const manifestFiles = files.filter(f => isManifest(f.filename))
  if (manifestFiles.length > 0) {
    const { data: compare } = await github.rest.repos.compareCommitsWithBasehead({ ...context.repo, basehead: `${pr.base.sha}...${pr.head.sha}` })
    const read = async (path, ref) => {
      const { data } = await github.rest.repos.getContent({ ...context.repo, path, ref, mediaType: { format: 'raw' } })
      return JSON.parse(data)
    }
    for (const f of manifestFiles) {
      manifests[f.filename] = {
        base: f.status === 'added' ? null : await read(f.previous_filename ?? f.filename, compare.merge_base_commit.sha),
        head: f.status === 'removed' ? null : await read(f.filename, pr.head.sha),
      }
    }
  }

  // The file list follows the live pull request, not `pr.head.sha`. A push, title edit or base change while
  // it was read starts its own run, which publishes the score for the new revision.
  const { data: current } = await github.rest.pulls.get({ ...context.repo, pull_number })
  if (current.head.sha !== pr.head.sha || current.base.ref !== pr.base.ref || current.title !== pr.title) {
    core.info(`#${pull_number} changed while its files were read; leaving the score to the newer run`)
    return
  }

  // A deleted fork leaves `head.repo` null, which still counts as a fork.
  const author = { login: pr.user.login, fork: pr.head.repo?.full_name !== pr.base.repo.full_name, association: pr.author_association }
  const assessment = assessRisk({ title: pr.title, author, files, manifests })
  const body = renderComment({ sha: pr.head.sha, assessment })

  const issue = { ...context.repo, issue_number: pull_number }
  const comments = await github.paginate(github.rest.issues.listComments, { ...issue, per_page: 100 })
  const existing = comments.find(c => c.user?.login === 'github-actions[bot]' && c.body.startsWith(COMMENT_MARKER))
  if (existing) await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body })
  else await github.rest.issues.createComment({ ...issue, body })

  core.info(`#${pull_number} at ${pr.head.sha}: ${LEVELS[assessment.level]} (${assessment.level}/4)`)
}
