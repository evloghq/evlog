import { EvlogError } from 'evlog'
import { eviErrors } from '../errors'
import { jobLogger } from '../job'
import { type Repository, repositorySlug } from '../repo'
import { MAINTAINER_GITHUB_LOGIN } from '../trust'
import { githubCredentialsFor } from './credentials'
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
 * session starts from a mention comment. A failed session may have no turn
 * auth to read, so `session.ended` recognizes an autonomous run by this shape.
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
  const token = await mintInstallationToken(githubCredentialsFor(repository))
  await ensureEscalationLabel(token, slug)
  await githubRequest(token, 'POST', `/repos/${slug}/issues/${issueNumber}/labels`, {
    labels: [ESCALATION_LABEL],
  })
  await githubRequest(token, 'POST', `/repos/${slug}/issues/${issueNumber}/assignees`, {
    assignees: [MAINTAINER_GITHUB_LOGIN],
  })
}

/**
 * Escalation from a failure handler. A second failure is recorded as a job
 * event and never thrown, so a triage failure cannot become a failure loop.
 */
export async function escalateFailedTriageQuietly(repository: Repository, issueNumber: number): Promise<void> {
  const log = jobLogger('github.escalate', { repository: repositorySlug(repository), issue: issueNumber })
  try {
    await escalateFailedTriage(repository, issueNumber)
    log.set({ escalated: true })
  } catch (error) {
    // Message and code only: `log.error(error)` would serialize `internal`, and the GitHub body belongs in no drain.
    const code = EvlogError.isEvlogError(error) ? error.code : undefined
    log.error((error as Error).message, { escalated: false, ...(code ? { reason: code } : {}) })
  }
  log.emit()
}

async function ensureEscalationLabel(token: string, slug: string): Promise<void> {
  const existing = await fetch(
    `${GITHUB_API}/repos/${slug}/labels/${encodeURIComponent(ESCALATION_LABEL)}`,
    { headers: headers(token) },
  )
  if (existing.ok) return
  if (existing.status !== 404) {
    throw eviErrors.GITHUB_REQUEST_FAILED({ request: 'label lookup', responseStatus: existing.status, internal: { body: await existing.text() } })
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
    throw eviErrors.GITHUB_REQUEST_FAILED({ request: 'label creation', responseStatus: created.status, internal: { body } })
  }
}

async function githubRequest(token: string, method: string, path: string, body: unknown): Promise<void> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: headers(token),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw eviErrors.GITHUB_REQUEST_FAILED({ request: `${method} ${path}`, responseStatus: response.status, internal: { body: await response.text() } })
  }
}

function headers(token: string): Record<string, string> {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}
