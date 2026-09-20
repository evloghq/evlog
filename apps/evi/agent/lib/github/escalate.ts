import { type Repository, repositorySlug } from '../repo'
import { MAINTAINER_GITHUB_LOGIN } from '../trust'
import { githubCredentials } from './credentials'
import { mintInstallationToken } from './push'

const GITHUB_API = 'https://api.github.com'

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
 * Silent escalation for a failed autonomous triage: label the issue and assign
 * the maintainer so it lands in his notifications, without posting a bot error
 * comment in front of the community.
 */
export async function escalateFailedTriage(repository: Repository, issueNumber: number): Promise<void> {
  const slug = repositorySlug(repository)
  const token = await mintInstallationToken(githubCredentials)
  await ensureEscalationLabel(token, slug)
  await githubRequest(token, 'POST', `/repos/${slug}/issues/${issueNumber}/labels`, {
    labels: [ESCALATION_LABEL],
  })
  await githubRequest(token, 'POST', `/repos/${slug}/issues/${issueNumber}/assignees`, {
    assignees: [MAINTAINER_GITHUB_LOGIN],
  })
}

async function ensureEscalationLabel(token: string, slug: string): Promise<void> {
  const existing = await fetch(
    `${GITHUB_API}/repos/${slug}/labels/${encodeURIComponent(ESCALATION_LABEL)}`,
    { headers: headers(token) },
  )
  if (existing.ok) return
  if (existing.status !== 404) {
    throw new Error(`GitHub label lookup failed (${existing.status}): ${await existing.text()}`)
  }
  const created = await fetch(`${GITHUB_API}/repos/${slug}/labels`, {
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
