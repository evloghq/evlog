/** First line of a PR Amp opens on Hugo's behalf. */
export const AMP_PR_DISCLAIMER = 'Written by an AI agent on behalf of @HugoRCD. @HugoRCD has not reviewed it yet.'

/** Linear issue label that always sends the coding work to Amp. */
export const AMP_LINEAR_LABEL = 'amp'

export const AMP_ROUTES = ['label', 'explicit', 'multi-file', 'tests', 'refactor'] as const

export type AmpRoute = (typeof AMP_ROUTES)[number]

export type AmpRouteDecision =
  | { readonly delegate: true, readonly reason: AmpRoute }
  | { readonly delegate: false, readonly reason: 'keep' }

const ACCESS_TOKEN_PREFIX = 'sgamp_'
const MULTI_FILE_THRESHOLD = 2
export const AMP_THREAD_ID = /^T-[A-Za-z0-9-]+$/
const AMP_THREAD_URL = /^https:\/\/ampcode\.com\/threads\/(T-[A-Za-z0-9-]+)(?:\/|\.md)?$/

export function ampApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.AMP_API_KEY
  if (typeof key !== 'string' || key.trim() === '') return null
  return key
}

/** Why Amp must not run: missing key, or a login session token Amp's CLI rejects. */
export function ampApiKeyProblem(key: string | null): 'missing' | 'session-token' | null {
  if (key === null) return 'missing'
  if (!key.startsWith(ACCESS_TOKEN_PREFIX)) return 'session-token'
  return null
}

/**
 * Delegate to Amp for labelled or explicit asks, refactors, work that needs
 * tests, or more than two files. Everything else stays with Evi.
 */
export function decideAmpRoute(input: {
  readonly labels?: readonly string[]
  readonly explicit?: boolean
  readonly filesToChange?: number
  readonly needsTests?: boolean
  readonly isRefactor?: boolean
}): AmpRouteDecision {
  const labels = (input.labels ?? []).map(label => label.toLowerCase())
  if (labels.includes(AMP_LINEAR_LABEL)) return { delegate: true, reason: 'label' }
  if (input.explicit) return { delegate: true, reason: 'explicit' }
  if (input.isRefactor) return { delegate: true, reason: 'refactor' }
  if (input.needsTests) return { delegate: true, reason: 'tests' }
  if ((input.filesToChange ?? 0) > MULTI_FILE_THRESHOLD) return { delegate: true, reason: 'multi-file' }
  return { delegate: false, reason: 'keep' }
}

export function parseAmpThreadId(value: string): string | null {
  const trimmed = value.trim()
  const fromUrl = AMP_THREAD_URL.exec(trimmed)
  if (fromUrl) return fromUrl[1] ?? null
  if (AMP_THREAD_ID.test(trimmed)) return trimmed
  return null
}

export function ampThreadUrl(sessionId: string | null): string | null {
  if (sessionId === null || !AMP_THREAD_ID.test(sessionId)) return null
  return `https://ampcode.com/threads/${sessionId}`
}

export function ampThreadTitle(brief: string, issue?: string): string {
  const oneLine = brief.replace(/\s+/g, ' ').trim()
  const body = oneLine.length === 0 ? 'Evi coding task' : oneLine
  const withIssue = issue && issue.trim() !== '' ? `${issue.trim()}: ${body}` : body
  const title = withIssue.slice(0, 200)
  return title.startsWith('-') ? `Evi: ${title}` : title
}

export interface AmpPromptInput {
  readonly brief: string
  readonly repository: string
  readonly branch?: string
  readonly issue?: string
  readonly paths?: readonly string[]
}

/** Prompt Amp sees: the brief, repo context, and the shipping rules Evi already enforces. */
export function buildAmpPrompt(input: AmpPromptInput): string {
  const paths = input.paths && input.paths.length > 0 ? input.paths.join(', ') : 'the paths the brief names'
  const branch = input.branch ?? 'main'
  const issue = input.issue ?? 'none'
  return [
    'You are Amp, running a coding task delegated by Evi, the evlog agent.',
    '',
    '## Task',
    input.brief.trim(),
    '',
    '## Repository',
    `GitHub: ${input.repository}`,
    `Base branch: ${branch}`,
    `Issue: ${issue}`,
    `Prefer these paths: ${paths}`,
    '',
    '## Rules that never bend',
    'Read AGENTS.md at the repository root and follow it. In particular:',
    '',
    '- Never merge a pull request, never enable auto-merge, never push to main or master.',
    '- Never add a Co-authored-by, Signed-off-by, "Generated with", or any signature that names an agent, model, or tool.',
    '- Never use an em dash. Use a comma, a colon, or a period.',
    '- Conventional Commits titles, lowercase subject.',
    '- A pull request body has this shape and nothing else: Why, Proof, Risk, Checks, then a GitHub ELI5 <details> block.',
    `- The first line of the pull request body must be exactly: ${AMP_PR_DISCLAIMER}`,
    '- Stop after the branch is pushed and the pull request is open. Evi will verify (tests, screenshots) and will not merge.',
    '',
    '## Done',
    'Reply with: the branch name, the pull request URL if you opened one, the checks you ran, and anything that failed or could not run.',
  ].join('\n')
}
