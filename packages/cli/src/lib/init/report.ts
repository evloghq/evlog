import type { CliContext } from '../../core/context'
import { gradientRule, HEADER_GRADIENT_WIDTH } from '../../core/brand'
import { DOCS_URL, createStyle } from '../../core/output'
import { skillsReportLines } from '../agents/report'
import { getFramework } from '../frameworks'
import { findDestination, findEnricher, findExtra, findSamplingPreset } from './catalog'
import type { FilePreview } from './diff'
import type { InitResult, VercelSummary } from './run'

/** What attaching the connector came to, with the line to add when init left the config alone. */
export function vercelOutcome(vercel: VercelSummary): string {
  const add = vercel.addTo && `add logs: { vercel: { connector: '${vercel.connector}' } } to ${vercel.addTo}`
  if (vercel.status === 'ready') {
    return add
      ? `${vercel.connector} is attached; ${add} so the deployed agent reads its Vercel runtime logs through it`
      : `the deployed agent reads its Vercel runtime logs through ${vercel.connector}`
  }
  return add
    ? `${add}; ${vercel.connector} is not ready yet: ${vercel.error}`
    : `${vercel.connector} is named in evlog.config.ts but not ready: ${vercel.error}`
}

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

  if (stoppedAtWrapper(result)) {
    const names = result.wrappers.join(', ')
    return paint('green', `evlog is already wired through ${names}, so there is nothing to install or scaffold here. Nothing was written.`)
  }

  const dev = findDestination(answers.devDrain)?.label ?? answers.devDrain
  const prod = answers.prodDrains.map(id => findDestination(id)?.label ?? id)
  lines.push([
    paint('bold', result.host ? `${answers.framework} + ${result.host}` : answers.framework),
    paint('dim', `service ${answers.service}`),
    ...(result.agentServices.length > 0 ? [paint('dim', `${result.agentServices.length > 1 ? 'agents' : 'agent'} ${result.agentServices.join(', ')}`)] : []),
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
    lines.push(`${paint('green', '✓')} ${paint('dim', `installed · ${install.command}`)}`)
  } else if (install.status === 'skipped') {
    lines.push(`${paint('yellow', '·')} ${paint('dim', `not installed yet — run ${install.command}`)}`)
  } else {
    lines.push(`${paint('red', '✗')} ${paint('dim', `install failed — run ${install.command}`)}`)
    if (install.error) lines.push(`   ${paint('dim', install.error)}`)
  }

  if (result.dryRun) {
    for (const preview of result.preview) {
      lines.push(`${paint('yellow', '·')} ${paint('dim', preview.kind === 'create' ? 'would create' : 'would update')} ${preview.file}${preview.by ? paint('dim', ` · by ${preview.by}`) : ''}`)
      lines.push(...previewLines(ctx, preview).map(line => `   ${line}`))
    }
  } else {
    for (const action of result.written) {
      lines.push(`${paint('green', '✓')} ${paint('dim', action.kind === 'create' ? 'created' : 'updated')} ${action.relative}`)
    }
  }

  for (const note of result.already) {
    lines.push(paint('dim', `· ${note}`))
  }

  for (const note of result.notes) {
    lines.push(`${paint('cyan', 'ℹ')} ${paint('dim', note)}`)
  }

  if (result.vercel) {
    const { vercel } = result
    if (vercel.status === 'pending') lines.push(`${paint('yellow', '·')} ${paint('dim', `would attach ${vercel.connector} to ${vercel.projectId} for the agent's Vercel logs`)}`)
    else if (vercel.status === 'ready' && !vercel.addTo) lines.push(`${paint('green', '✓')} ${paint('dim', vercelOutcome(vercel))}`)
    else lines.push(`${paint(vercel.status === 'ready' ? 'yellow' : 'red', vercel.status === 'ready' ? '!' : '✗')} ${paint('dim', vercelOutcome(vercel))}`)
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
  lines.push(`${paint('dim', 'setup guide →')} ${docLink(ctx, getFramework(answers.framework).docs)}`)

  return lines.join('\n')
}

/** A preview's diff hunks, coloured the way `git diff` colours them. */
export function previewLines(ctx: CliContext, preview: FilePreview): string[] {
  const { paint } = createStyle(ctx)
  return preview.lines.map((line) => {
    if (line.startsWith('@@')) return paint('cyan', line)
    if (line.startsWith('+')) return paint('green', line)
    if (line.startsWith('-')) return paint('red', line)
    return paint('dim', line)
  })
}

/** Header for a workspace run, above each app's own report. */
export function formatWorkspaceHeading(ctx: CliContext, label: string): string {
  const { paint } = createStyle(ctx)
  return `\n${paint(['bold', 'cyan'], `── ${label} `)}${paint('dim', '─'.repeat(Math.max(0, 40 - label.length)))}`
}

/** `init` stopped because evlog reaches the app only through a wrapper package. */
function stoppedAtWrapper(result: InitResult): boolean {
  return result.wrappers.length > 0 && result.install.status === 'already' && result.install.version === undefined
}
