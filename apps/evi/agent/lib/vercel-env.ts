/**
 * Policy for the gated Vercel env-var write surface. Pure functions so the
 * decision is unit-testable: the tool's `approval` and its `execute` both run
 * the same check, so a bypass of one does not open the other.
 */

/**
 * Agent-config keys the tool may set without a prompt. These name Evi's own
 * connection configuration, never a secret, and setting one only changes how
 * the next deployment connects.
 */
export const AUTO_APPROVED_KEYS: ReadonlySet<string> = new Set([
  'EVI_VERCEL_MCP_ROUTE',
  'EVI_VERCEL_DOCS_PROJECT_ID',
  'EVI_VERCEL_API_CONNECTOR',
  'EVI_VERCEL_WRITABLE_PROJECTS',
])

/** Key shapes that are secrets by name, rejected even when a human approves. */
const SECRET_KEY_PATTERN = /(token|secret|password|private|credential|dsn|database_url|api_?key|auth)/i

/**
 * Projects the allowlist may auto-approve on, from the environment. Empty by
 * default: an unset list means every write asks, nothing auto-runs.
 */
export function writableProjects(env: Partial<NodeJS.ProcessEnv> = process.env): string[] {
  return (env.EVI_VERCEL_WRITABLE_PROJECTS ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0)
}

export type EnvVarWriteInput = {
  projectId: string
  key: string
}

export type EnvVarWriteDecision =
  | { type: 'approved', reason: string }
  | { type: 'denied', reason: string }
  | 'user-approval'
  | 'not-applicable'

/** Two gated writes in one step park the Slack session after Approve. Serialize them. */
export const SEQUENTIAL_APPROVAL_RULE = 'Never raise two Approve cards in the same step. Call `set_vercel_env` once, wait for Approve, report the result, then the next. Independent reads may still run in parallel.'

/**
 * The write policy, as Hugo specified it: allowlisted non-secret keys on
 * allowlisted projects run on their own, everything else pauses for a human,
 * and secret-shaped keys are refused outright. An unlisted project never
 * auto-approves even for a known key: the project list is the boundary.
 */
export function decideEnvVarWrite(input: EnvVarWriteInput, env: Partial<NodeJS.ProcessEnv> = process.env): EnvVarWriteDecision {
  if (SECRET_KEY_PATTERN.test(input.key)) {
    return { type: 'denied', reason: `"${input.key}" looks like a secret, and the env-var tool never writes secret-shaped keys.` }
  }
  if (!writableProjects(env).includes(input.projectId)) {
    return 'user-approval'
  }
  if (AUTO_APPROVED_KEYS.has(input.key)) {
    return { type: 'approved', reason: `"${input.key}" is an allowlisted non-secret agent-config key on a writable project.` }
  }
  return 'user-approval'
}
