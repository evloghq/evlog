import type { SessionAuthContext } from 'eve/context'
import type { ApprovalStatus } from 'eve/tools/approval'
import { isAutonomous, isMaintainer, isPullRequestReview } from '../trust'

const LABEL_NAME_MAX = 50
const LABEL_DESCRIPTION_MAX = 100
/** Taxonomy-shaped names only — rejects whitespace padding, URLs, and free-form injection. */
const LABEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9 ._:@-]{0,49}$/
const LABEL_COLOR = /^[0-9a-fA-F]{6}$/
/** LF, CR, and Unicode line/paragraph separators. */
const MULTILINE = /[\n\r\u2028\u2029]/

/**
 * Default write gate: autonomous turns are denied; maintainers skip the card;
 * everyone else needs approval.
 */
export function writePolicy(auth: SessionAuthContext | null): ApprovalStatus {
  if (isPullRequestReview(auth)) return { type: 'denied', reason: 'PR review sessions may only publish their scoped review and suggestions.' }
  if (isAutonomous(auth)) {
    return {
      type: 'denied',
      reason: 'Autonomous turns may only create or apply labels, open a doc-gap issue, or assign the maintainer.',
    }
  }
  return isMaintainer(auth) ? 'not-applicable' : 'user-approval'
}

/**
 * Shape-check the payload the tool will receive (no trim-then-accept).
 * Returns a denial reason, or null when the input is acceptable for autonomous create.
 */
export function autonomousCreateLabelDenial(toolInput: unknown): string | null {
  const input = toolInput as { name?: unknown, color?: unknown, description?: unknown } | undefined
  const name = typeof input?.name === 'string' ? input.name : ''
  const color = typeof input?.color === 'string' ? input.color : ''
  const description = input?.description === undefined || input?.description === null
    ? undefined
    : typeof input.description === 'string' ? input.description : null

  if (
    !name
    || name !== name.trim()
    || name.length > LABEL_NAME_MAX
    || !LABEL_NAME.test(name)
    || MULTILINE.test(name)
  ) {
    return 'Autonomous createLabel requires a short taxonomy-shaped name with no surrounding whitespace.'
  }
  if (!LABEL_COLOR.test(color)) {
    return 'Autonomous createLabel requires a 6-digit hex color.'
  }
  if (
    description === null
    || (description !== undefined && (
      description !== description.trim()
      || description.length > LABEL_DESCRIPTION_MAX
      || MULTILINE.test(description)
    ))
  ) {
    return 'Autonomous createLabel description must be a short single line with no surrounding whitespace.'
  }
  return null
}

/**
 * Autonomous createLabel may grow the triage taxonomy when the payload is
 * taxonomy-shaped. Provenance cannot be proven at the approval layer alone
 * (the issue body is untrusted); shape limits blast radius. Non-autonomous
 * callers fall through to {@link writePolicy}.
 */
export function createLabelPolicy(
  auth: SessionAuthContext | null,
  toolInput: unknown,
): ApprovalStatus {
  if (!isAutonomous(auth)) return writePolicy(auth)
  const reason = autonomousCreateLabelDenial(toolInput)
  return reason ? { type: 'denied', reason } : 'not-applicable'
}
