import { gradientRule, HEADER_GRADIENT_WIDTH } from '../../core/brand'
import type { CliContext } from '../../core/context'
import { DOCS_URL, createStyle } from '../../core/output'
import type { AgentsResult } from './run'

/** The subset of a skills outcome the report needs — `init` reports one too. */
export interface SkillsLines {
  status: 'pending' | 'already' | 'installed' | 'skipped' | 'failed'
  command: string
  dirs?: string[]
  error?: string
}

/**
 * How the skills step went, as report lines.
 *
 * Shared with the `init` report rather than written twice: it is the same four
 * outcomes with the same wording, and two copies of a user-facing string are
 * two copies that drift. A command to type is a label plus the command, never a
 * sentence with the command inside it — inline, the reader never registers
 * there is something to run.
 */
export function skillsReportLines(ctx: CliContext, skills: SkillsLines): string[] {
  const { paint } = createStyle(ctx)
  const command = (label: string, line: string): string =>
    `  ${paint('dim', label)}  ${paint('bold', line)}`

  switch (skills.status) {
    case 'already':
      /* The "already installed" fact is the run's plan entry, printed once there:
         repeating it here reads as two events. The refresh command is the part
         this line adds, and the skills CLI owns their lifecycle, so it is theirs. */
      return [command('refresh', 'npx skills update')]
    case 'installed':
      return [
        `${paint('green', '✓')} ${paint('dim', 'installed the evlog skills')}`,
        /* A non-interactive run never saw the command go by, and this is the
           only record of what was spawned on its behalf. */
        command('ran    ', skills.command),
      ]
    case 'failed':
      return [
        `${paint('red', '✗')} ${paint('dim', 'skills not installed')}`,
        ...(skills.error ? [`   ${paint('dim', skills.error)}`] : []),
        command('retry  ', skills.command),
      ]
    default:
      return [
        `${paint('yellow', '·')} ${paint('dim', 'skills not installed')}`,
        command('install', skills.command),
      ]
  }
}

/**
 * What `evlog agents` did, for a run that asked nothing.
 *
 * Same contract as the `init` report: every outcome gets a line, including the
 * ones where nothing changed, so "already up to date" is never confusable with
 * "did not look".
 */
export function formatAgentsReport(ctx: CliContext, result: AgentsResult): string {
  const { paint } = createStyle(ctx)
  const lines: string[] = []

  if (result.cancelled) {
    return paint('yellow', 'Cancelled — nothing was written.')
  }

  lines.push(paint('bold', result.framework ?? 'no framework detected'))
  lines.push('')

  for (const action of result.written) {
    const verb = result.dryRun
      ? (action.kind === 'create' ? 'would create' : 'would update')
      : (action.kind === 'create' ? 'created' : 'updated')
    const glyph = result.dryRun ? paint('yellow', '·') : paint('green', '✓')
    lines.push(`${glyph} ${paint('dim', verb)} ${action.relative}`)
  }

  for (const note of result.already) {
    lines.push(paint('dim', `· ${note}`))
  }

  lines.push(...skillsReportLines(ctx, result.skills))

  lines.push('')
  lines.push(gradientRule(ctx, HEADER_GRADIENT_WIDTH))
  if (result.dryRun) {
    lines.push(paint('dim', 'dry run — nothing was written. Drop --dry-run to apply.'))
  } else {
    lines.push(`${paint('dim', 'next:')} ${paint('bold', 'evlog map')} ${paint('dim', 'to score what is still dark')}`)
  }
  lines.push(`${paint('dim', 'agent skills →')} ${paint('dim', `${DOCS_URL}/reference/agent-skills`)}`)

  return lines.join('\n')
}
