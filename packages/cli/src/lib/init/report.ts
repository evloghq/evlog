import type { CliContext } from '../../core/context'
import { gradientRule, HEADER_GRADIENT_WIDTH } from '../../core/brand'
import { DOCS_URL, createStyle } from '../../core/output'
import { skillsReportLines } from '../agents/report'
import { findDestination, findEnricher, findExtra, findSamplingPreset } from './catalog'
import { frameworkDocs } from './run'
import type { InitResult } from './run'

function docLink(ctx: CliContext, path: string): string {
  const style = createStyle(ctx)
  return ctx.color ? style.link(`${DOCS_URL}${path}`, `evlog.dev${path}`) : `evlog.dev${path}`
}

/**
 * What `init` did, for a run that asked nothing.
 *
 * The interactive flow narrates itself through clack, so this renders only when
 * prompts were skipped — which is the mode an agent or a CI job runs in, and the
 * one whose output somebody will read in a log days later. Every outcome gets a
 * line, including the ones where nothing happened: a setup command that prints
 * only its writes leaves the reader unable to tell "already wired" from "did
 * not look".
 */
export function formatInitReport(ctx: CliContext, result: InitResult): string {
  const { paint } = createStyle(ctx)
  const { answers } = result
  const lines: string[] = []

  if (result.cancelled) {
    return paint('yellow', 'Cancelled — nothing was written.')
  }

  const dev = findDestination(answers.devDrain)?.label ?? answers.devDrain
  const prod = answers.prodDrains.map(id => findDestination(id)?.label ?? id)
  lines.push([
    paint('bold', answers.framework),
    paint('dim', `service ${answers.service}`),
    paint('dim', `dev → ${dev}`),
    paint('dim', `prod → ${prod.length > 0 ? prod.join(' + ') : 'not set'}`),
  ].join(paint('dim', ' · ')))

  if (answers.extras.length > 0) {
    const labels = answers.extras.map((id) => {
      if (id === 'enrichers') {
        const names = answers.enrichers.map(enricher => findEnricher(enricher)?.label ?? enricher)
        return `enrichers (${names.join(', ')})`
      }
      if (id === 'sampling') {
        return `sampling (${findSamplingPreset(answers.sampling)?.label ?? answers.sampling})`
      }
      return findExtra(id)?.label ?? id
    })
    lines.push(paint('dim', `extras: ${labels.join(' · ')}`))
  }
  lines.push('')

  const { install } = result
  if (install.status === 'already') {
    lines.push(`${paint('green', '✓')} evlog ${paint('dim', `already installed${install.version ? ` (${install.version})` : ''}`)}`)
  } else if (install.status === 'installed') {
    lines.push(`${paint('green', '✓')} ${paint('dim', `installed evlog · ${install.command}`)}`)
  } else if (install.status === 'skipped') {
    lines.push(`${paint('yellow', '·')} ${paint('dim', `evlog is not installed — run ${install.command}`)}`)
  } else {
    lines.push(`${paint('red', '✗')} ${paint('dim', `install failed — run ${install.command}`)}`)
    if (install.error) lines.push(`   ${paint('dim', install.error)}`)
  }

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

  for (const id of result.dropped) {
    /* Silently dropping an extra would leave the author believing they wired
       something they did not. */
    lines.push(`${paint('yellow', '·')} ${paint('dim', `${id} does not apply here — skipped`)}`)
  }

  /* The block lands whatever happens here; saying nothing would leave the
     author believing their agent has guidance it never received. */
  if (result.agentGuide) {
    lines.push(...skillsReportLines(ctx, result.agentGuide))
  }

  if (result.verified) {
    const { ok, warn, fail } = result.verified
    const glyph = fail > 0 ? paint('red', '✗') : warn > 0 ? paint('yellow', '⚠') : paint('green', '✓')
    lines.push(`${glyph} ${paint('dim', `doctor: ${ok} ok · ${warn} warn · ${fail} fail`)}`)
  }

  if (result.manual.length > 0) {
    lines.push('')
    lines.push(paint('dim', 'YOUR TURN'))
    for (const step of result.manual) {
      lines.push(`${paint('yellow', '→')} ${paint('bold', step.title)} ${paint('dim', `· ${step.file}`)}`)
      lines.push(`   ${paint('dim', step.reason)}`)
      for (const line of step.snippet.split('\n')) {
        lines.push(`   ${paint('cyan', line)}`)
      }
      lines.push('')
    }
  } else {
    lines.push('')
  }

  lines.push(gradientRule(ctx, HEADER_GRADIENT_WIDTH))
  if (result.dryRun) {
    lines.push(paint('dim', 'dry run — nothing was written. Drop --dry-run to apply.'))
  } else {
    lines.push(`${paint('dim', 'next:')} ${paint('bold', 'evlog map')} ${paint('dim', 'to score what is still dark')}`)
  }
  lines.push(`${paint('dim', 'setup guide →')} ${docLink(ctx, frameworkDocs(answers.framework))}`)

  return lines.join('\n')
}

/** Header for a workspace run, above each app's own report. */
export function formatWorkspaceHeading(ctx: CliContext, label: string): string {
  const { paint } = createStyle(ctx)
  return `\n${paint(['bold', 'cyan'], `── ${label} `)}${paint('dim', '─'.repeat(Math.max(0, 40 - label.length)))}`
}
