import { MAINTAINER_GITHUB_LOGIN } from '../trust'
import { GITHUB_API, OWNER, REPO } from './repo'
import { githubCredentials } from './credentials'
import { mintInstallationToken } from './push'

export const ESCALATION_LABEL = 'evi:needs-attention'

interface ChannelStateSlice {
  readonly issueNumber: number | null
  readonly triggeringCommentId: number | null
}

/**
 * A first-responder session is the only GitHub dispatch with no triggering
 * comment: it starts from the `issues` webhook, while every interactive
 * session starts from a mention comment. `session.failed` handlers receive no
 * session auth, so this state shape is how they recognize an autonomous run.
 */
export function isAutonomousTriageState(state: ChannelStateSlice): boolean {
  return state.issueNumber !== null && state.triggeringCommentId === null
}

/**
 * needs-maintainer probability at or above which the triage router escalates
 * before the turn runs instead of waiting for the turn to fail. Deliberately
 * above the routing thresholds: a wrong assignment notifies the maintainer, a
 * wrong cheap turn only costs some reasoning budget.
 */
export const PRE_ESCALATION_THRESHOLD = 0.85

/** The escalate.ts decision over the router's needs-maintainer signal. */
export function shouldPreEscalate(probability: number): boolean {
  return probability >= PRE_ESCALATION_THRESHOLD
}

/**
 * Silent escalation: label the issue and assign the maintainer so it lands in
 * his notifications, without posting a bot error comment in front of the
 * community. Runs for a failed autonomous triage, and before the turn starts
 * when the triage router's needs-maintainer signal clears
 * `PRE_ESCALATION_THRESHOLD` (deterministic code decides, Jev only informs).
 */
export async function escalateTriage(issueNumber: number, token?: string): Promise<void> {
  const credentials = token ?? await mintInstallationToken(githubCredentials)
  await ensureEscalationLabel(credentials)
  await githubRequest(credentials, 'POST', `/repos/${OWNER}/${REPO}/issues/${issueNumber}/labels`, {
    labels: [ESCALATION_LABEL],
  })
  await assignMaintainer(issueNumber, credentials)
}

/** Notification-only pre-escalation: no label, because Evi has not failed here. */
export async function preEscalateTriage(issueNumber: number, token: string): Promise<void> {
  await assignMaintainer(issueNumber, token)
}

export async function assignMaintainer(issueNumber: number, token: string): Promise<void> {
  await githubRequest(token, 'POST', `/repos/${OWNER}/${REPO}/issues/${issueNumber}/assignees`, {
    assignees: [MAINTAINER_GITHUB_LOGIN],
  })
}
async function ensureEscalationLabel(token: string): Promise<void> {
  const existing = await fetch(
    `${GITHUB_API}/repos/${OWNER}/${REPO}/labels/${encodeURIComponent(ESCALATION_LABEL)}`,
    { headers: headers(token) },
  )
  if (existing.ok) return
  if (existing.status !== 404) {
    throw new Error(`GitHub label lookup failed (${existing.status}): ${await existing.text()}`)
  }
  const created = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/labels`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      name: ESCALATION_LABEL,
      color: 'B60205',
      description: 'Evi failed on this issue and a human needs to take over',
    }),
  })
  if (!created.ok) {
    const body = await created.text()
    // already_exists: another session created it between the lookup and here.
    if (created.status === 422 && body.includes('"already_exists"')) return
    throw new Error(`GitHub label creation failed (${created.status}): ${body}`)
  }
}

async function githubRequest(token: string, method: string, path: string, body: unknown): Promise<void> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: headers(token),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${await response.text()}`)
  }
}

function headers(token: string): Record<string, string> {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}
