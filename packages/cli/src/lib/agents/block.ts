import type { Framework } from '../map/types'

/**
 * The evlog section of a project's `AGENTS.md`.
 *
 * Everything between the markers is ours to rewrite; everything outside them is
 * the author's and is never touched. That split is the whole reason this command
 * can be re-run — the block tracks the CLI, the file tracks the project.
 */

export const MARKER_START = '<!-- evlog:start -->'
export const MARKER_END = '<!-- evlog:end -->'

export interface BlockInput {
  /** `null` when detection found nothing — the block is still worth writing. */
  framework: Framework | null
  /** Whether the evlog skills are installed, for the closing pointer. */
  hasSkills: boolean
}

/** How a request-scoped logger is obtained, per framework. */
const ACCESSOR: Record<Framework, string> = {
  'nuxt': '`useLogger(event)` (auto-imported) inside a `server/api` handler',
  'nitro': '`useLogger(event)` from `evlog/nitro` inside a route handler',
  'next': '`useLogger()` from your `lib/evlog.ts` inside a route handler',
  'tanstack-start': '`req.context.log` inside a server route',
  'hono': '`c.get(\'log\')` or `useLogger()` from `evlog/hono` inside a route handler',
  'express': '`req.log` inside a route handler',
  'fastify': '`req.log` inside a route handler',
  'elysia': '`log` inside a route handler',
}

const DEFAULT_ACCESSOR = '`useLogger()` inside a request handler'

/**
 * Render the block.
 *
 * Deliberately short: this lands in a file every agent reads on every turn, so
 * it carries the rules and points at the skills for the depth. Prose that would
 * only restate an example is left out.
 */
export function renderBlock(input: BlockInput): string {
  const accessor = input.framework ? ACCESSOR[input.framework] : DEFAULT_ACCESSOR

  /* Which directory the skills landed in is the agent's business, not ours —
     naming one would be wrong for every agent that reads a different path. */
  const closing = input.hasSkills
    ? 'Deeper guidance is in the `review-logging-patterns` skill — read it before a logging change.'
    : 'Deeper guidance: https://evlog.dev/learn/wide-events'

  return [
    MARKER_START,
    '## Logging with evlog',
    '',
    'This project uses [evlog](https://evlog.dev). Follow these rules when you add or change logging.',
    '',
    '**One wide event per operation.** A request, a job, a user action — each produces exactly one',
    'event carrying everything about it. Not one log line per step.',
    '',
    `- Get the request logger with ${accessor}.`,
    '- Add context as you learn it: `log.set({ user: { id, plan }, cart: { items, total } })`.',
    '- Group related fields into objects. Never flat abbreviations like `{ uid, n, t }`.',
    '- Never pass a raw body — `log.set({ user: body })` leaks passwords. List fields explicitly.',
    '- Do not time anything by hand; the duration is computed when the event emits.',
    '- `log.debug()` is for step detail and is stripped from production builds.',
    '',
    '**Errors are structured, never bare.**',
    '',
    '```ts',
    'throw createError({',
    '  message: \'Payment failed\',',
    '  status: 402,',
    '  why: \'Card declined by the issuer\',',
    '  fix: \'Use a different payment method\',',
    '  internal: { correlationId },   // drains only — never reaches the client',
    '})',
    '```',
    '',
    'Never `throw new Error(...)`. Never `console.error(e); throw e` — use `log.error(e)`.',
    'When the same error appears in three or more places, promote it to `defineErrorCatalog()`.',
    '',
    '**Sensitive actions get an audit trail.** Call `log.audit({ action, actor, target, outcome })`',
    'on anything that changes permissions, money, or personal data. Audit entries are never sampled.',
    '',
    '**Never log** passwords, tokens, API keys, full card numbers, or session JWTs. Redaction is on',
    'in production, but it is a safety net — not a substitute for choosing the fields yourself.',
    '',
    'Check coverage with `npx @evlog/cli map --no-write`. Diagnose setup with `npx @evlog/cli doctor`.',
    closing,
    MARKER_END,
    '',
  ].join('\n')
}

/**
 * Put `block` into `source`, replacing an existing one.
 *
 * Returns `null` when the file already says exactly this, which is what makes a
 * second run a no-op rather than a no-op-shaped rewrite.
 */
export function upsertBlock(source: string, block: string): string | null {
  const start = source.indexOf(MARKER_START)
  const end = source.indexOf(MARKER_END)

  if (start === -1 || end === -1 || end < start) {
    const separator = source.length === 0 || source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n'
    return `${source}${separator}${block}`
  }

  const next = `${source.slice(0, start)}${block.trimEnd()}${source.slice(end + MARKER_END.length)}`
  return next === source ? null : next
}

/** A fresh `AGENTS.md` for a project that has none. */
export function renderAgentsFile(projectName: string, block: string): string {
  return `# ${projectName}\n\nInstructions for AI coding agents working in this repository.\n\n${block}`
}

/** The line that points Claude Code at `AGENTS.md` instead of duplicating it. */
export const CLAUDE_POINTER = '@AGENTS.md'

/**
 * Add the pointer to a `CLAUDE.md`, or `null` when it already refers to AGENTS.md.
 *
 * Matches any mention rather than the exact line: a file that already says
 * "see AGENTS.md" in prose does not need a second instruction.
 */
export function upsertClaudePointer(source: string | null): string | null {
  if (source === null) return `${CLAUDE_POINTER}\n`
  if (source.includes('AGENTS.md')) return null
  return `${source.endsWith('\n') ? source : `${source}\n`}\n${CLAUDE_POINTER}\n`
}
