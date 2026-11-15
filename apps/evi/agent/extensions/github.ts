import githubExtension from '@github-tools/eve-extension'
import type { ApprovalContext, ApprovalStatus } from 'eve/tools/approval'
import { GITHUB_CONNECTOR } from '../lib/github/credentials'
import { createLabelPolicy, writePolicy } from '../lib/github/label-approval'
import { createPullRequestPolicy } from '../lib/github/pull-request-approval'
import { homeRepository } from '../lib/repo'
import { isAutonomous, MAINTAINER_GITHUB_LOGIN } from '../lib/trust'

/**
 * `preset: 'auto'` lists only the tools a session's first request needs, and
 * defers the rest behind `eve__search`. These writes stay out of reach whatever
 * the routing picks: merges, releases (AGENTS.md forbids an agent creating
 * one), branch and file writes (code ships through `git__gh` from the
 * sandbox), CI control, deletions, gists and reactions.
 */
const EXCLUDED_WRITES = [
  'mergePullRequest',
  'enablePullRequestAutoMerge',
  'disablePullRequestAutoMerge',
  'updatePullRequestBranch',
  'createRelease',
  'updateRelease',
  'deleteRelease',
  'createBranch',
  'deleteBranch',
  'createOrUpdateFile',
  'editFiles',
  'createRepository',
  'forkRepository',
  'triggerWorkflow',
  'rerunWorkflowRun',
  'cancelWorkflowRun',
  'createCommitStatus',
  'deleteIssueComment',
  'deletePullRequestComment',
  'deleteLabel',
  'addSubIssue',
  'replyToReviewComment',
  'resolveReviewThread',
  'addCommentReaction',
  'addIssueReaction',
  'markNotificationRead',
  'createGist',
  'updateGist',
  'deleteGist',
  'createGistComment',
] as const

/**
 * Autonomous first-responder turns may create/apply labels, open a doc-gap issue,
 * or assign the maintainer, and nothing else. Everything else is denied
 * outright: the turn runs unattended, so an approval request would park
 * forever, and its reply is posted by the channel.
 */
function policy(ctx: ApprovalContext): ApprovalStatus {
  return writePolicy(ctx.session.auth.current)
}

/** The writes an autonomous turn may reach: reversible and low blast radius. */
function autonomousWrite(ctx: ApprovalContext): ApprovalStatus {
  return isAutonomous(ctx.session.auth.current) ? 'not-applicable' : policy(ctx)
}

/** Escalation: an autonomous turn assigns the issue to the maintainer, and no one else. */
function assignPolicy(ctx: ApprovalContext): ApprovalStatus {
  if (isAutonomous(ctx.session.auth.current)) {
    const assignees = (ctx.toolInput as { assignees?: unknown } | undefined)?.assignees
    const ok = Array.isArray(assignees)
      && assignees.length > 0
      && assignees.every((assignee) => String(assignee).toLowerCase() === MAINTAINER_GITHUB_LOGIN)
    return ok ? 'not-applicable' : { type: 'denied', reason: `Autonomous turns may only assign ${MAINTAINER_GITHUB_LOGIN}.` }
  }
  return policy(ctx)
}

export default githubExtension({
  connector: GITHUB_CONNECTOR,
  context: homeRepository(),
  preset: 'auto',
  exclude: [...EXCLUDED_WRITES],
  // A person's own GitHub access bounds what their turn does; schedules and autonomous triage run as the App.
  actAs: 'caller',
  // Write tools without a policy keep the default always(): closeIssue, createPullRequestReview.
  requireApproval: {
    // Reversible and harmless on every kind of run; a card here only slows the PR flow down.
    requestReviewers: (): ApprovalStatus => 'not-applicable',
    createPullRequest: (ctx: ApprovalContext) => createPullRequestPolicy(ctx.session.auth.current, ctx.toolInput),
    updatePullRequest: policy,
    createIssue: autonomousWrite,
    updateIssue: policy,
    addIssueComment: policy,
    updateIssueComment: policy,
    addPullRequestComment: policy,
    updatePullRequestComment: policy,
    addDiscussionComment: policy,
    addAssignees: assignPolicy,
    removeAssignees: policy,
    addLabels: autonomousWrite,
    removeLabel: policy,
    createLabel: (ctx: ApprovalContext) => createLabelPolicy(ctx.session.auth.current, ctx.toolInput),
    updateLabel: policy,
  },
})
