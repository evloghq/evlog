/**
 * Score a pull request and publish the result as a Linear `riskScore` in a
 * sticky comment, bound to the head commit SHA.
 *
 * Runs from `.github/workflows/risk-score.yml` through `actions/github-script`,
 * which passes an authenticated Octokit and the event context. The score is
 * computed by the rules in `lib.mjs` from the file list and title the GitHub
 * API returns; no code from the pull request is checked out or executed.
 *
 * Linear reads the `<!-- linear:extension ... -->` block once the repository is
 * connected through the Linear GitHub integration with code access. No secret
 * beyond the workflow's `GITHUB_TOKEN` is needed.
 *
 * Format and validation rules: https://linear.app/docs/diffs#risk-score
 */
import { assessRisk, COMMENT_MARKER, LEVELS, renderComment } from './lib.mjs'

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

  const assessment = assessRisk({ title: pr.title, files })
  const body = renderComment({ sha: pr.head.sha, assessment })

  const issue = { ...context.repo, issue_number: pull_number }
  const comments = await github.paginate(github.rest.issues.listComments, { ...issue, per_page: 100 })
  const existing = comments.find(c => c.user?.login === 'github-actions[bot]' && c.body.startsWith(COMMENT_MARKER))
  if (existing) await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body })
  else await github.rest.issues.createComment({ ...issue, body })

  core.info(`#${pull_number} at ${pr.head.sha}: ${LEVELS[assessment.level]} (${assessment.level}/4)`)
}
