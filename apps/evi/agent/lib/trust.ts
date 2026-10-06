import type { SessionAuthContext } from 'eve/context'
import { defineState } from 'eve/context'
import { environment } from './environment'

/** Native session state records checkout and publication, not pending approvals. */
export const reviewState = defineState('evi.pr-review', () => ({
  prepared: false,
  publishing: false,
  url: null as string | null,
}))

/**
 * Hugo's identity on each channel, read from the environment so the public
 * repo carries no personal identifiers. A missing variable removes that
 * channel from the trusted set, so its writes fall back to asking.
 */
export const { MAINTAINER_PHONE, MAINTAINER_GITHUB_ID } = process.env
/**
 * The one Slack workspace the connector is installed in. Private, and only
 * Hugo can install or invite there, so every human in it is trusted as him.
 */
export const { EVI_SLACK_TEAM_ID } = process.env
/** Hugo's GitHub login, used to assign escalated issues to him. Public handle, not a credential. */
export const MAINTAINER_GITHUB_LOGIN = 'hugorcd'

/** Exported for memory identity seeding, which needs the members, not the answer. */
export const MAINTAINER_PRINCIPALS: ReadonlySet<string> = new Set(
  [
    MAINTAINER_GITHUB_ID && `github:${MAINTAINER_GITHUB_ID}`,
    process.env.MAINTAINER_LINEAR_ID && `linear:${process.env.MAINTAINER_LINEAR_ID}`,
    MAINTAINER_PHONE && `imessage:${MAINTAINER_PHONE}`,
    // The MCP and web channels only mint this principal after verifying the
    // maintainer bearer token, so configuring the token is what admits them.
    process.env.EVI_MAINTAINER_TOKEN && 'mcp:hugo',
  ].filter((principal): principal is string => Boolean(principal)),
)

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.')
  if (payload === undefined) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * A local `eve dev` session counts as the maintainer only when the process
 * also holds a Vercel OIDC token for this project's team: the repo is public,
 * but that token only lands in `.env.local` through `vercel env pull` under
 * an authorized Vercel login. Claims are decoded, not signature-verified, and
 * expiry is ignored on purpose: possession is the signal, not freshness.
 * Deployments and eval runs never resolve to `local`.
 */
function isTrustedLocalDev(): boolean {
  if (environment() !== 'local') return false
  const token = process.env.VERCEL_OIDC_TOKEN
  if (!token) return false
  const claims = decodeJwtClaims(token)
  if (claims === null) return false
  const team = process.env.VERCEL_TEAM_ID
  return team === undefined || claims.owner_id === team
}

/** eve mints `slack:<team>:<member>` for humans and `slack:<team>:bot:<id>` for bots. */
function isWorkspaceMember(auth: SessionAuthContext): boolean {
  return EVI_SLACK_TEAM_ID !== undefined
    && auth.authenticator === 'slack-webhook'
    && auth.principalType === 'user'
    && auth.principalId.startsWith(`slack:${EVI_SLACK_TEAM_ID}:`)
}

export function isMaintainer(auth: SessionAuthContext | null): boolean {
  if (isPullRequestReview(auth)) return false
  if (isTrustedLocalDev()) return true
  if (auth === null) return false
  return MAINTAINER_PRINCIPALS.has(auth.principalId) || isWorkspaceMember(auth)
}

/**
 * The constructed principal for unattended GitHub turns (first responder on
 * new issues). Projected actors always carry a numeric `github:<id>`, so this
 * fixed login cannot collide with a real one.
 */
export const AUTONOMOUS_GITHUB_PRINCIPAL = 'github:evlogai'

/** Unattended turns: comment-only, never trusted, nothing may park on a card. */
export function isAutonomous(auth: SessionAuthContext | null): boolean {
  return auth !== null && auth.principalId === AUTONOMOUS_GITHUB_PRINCIPAL
}

/** The restricted identity minted by the GitHub PR approval handoff. */
export function isPullRequestReview(auth: SessionAuthContext | null): boolean {
  return auth !== null
    && auth.authenticator === 'pr-review'
    && auth.principalType === 'service'
    && auth.principalId === 'evi:pr-review'
}

/** Review authority identifies one approval, never a maintainer or a schedule. */
export function pullRequestReviewAuth(scope: { owner: string, repo: string, number: number, sha: string }): SessionAuthContext {
  return { authenticator: 'pr-review', principalType: 'service', principalId: 'evi:pr-review', attributes: { ...scope, number: String(scope.number) } }
}

/** Approved reviews may publish visual evidence, but cannot access admin tools. */
export function canCaptureEvidence(auth: SessionAuthContext | null): boolean {
  return canAccessAdminTools(auth) || (isPullRequestReview(auth) && reviewState.get().prepared)
}

/** Maintainers and scheduled app turns may access admin observability tools. */
export function canAccessAdminTools(auth: SessionAuthContext | null): boolean {
  return isMaintainer(auth) || isScheduleAppAuth(auth)
}

/**
 * The app principal eve stamps on schedule-dispatched turns (eve
 * `channel/schedule-auth`). Schedule turns may push feature branches so the
 * upstream-sync run can deliver its PRs; they are never a user identity and
 * can never touch main.
 */
export function isScheduleAppAuth(auth: SessionAuthContext | null): boolean {
  return auth !== null
    && auth.authenticator === 'app'
    && auth.principalId === 'eve:app'
    && auth.principalType === 'runtime'
}
