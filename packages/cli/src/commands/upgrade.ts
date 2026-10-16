import { defineEvlogCommand } from '../lib/command'
import { UPGRADE_TRANSFORMS } from '../lib/upgrade/transforms'
import type { UpgradeTransform } from '../lib/upgrade/transforms'

/** The plan `evlog upgrade` reports. The scaffold reads the table and changes no files. */
export function planUpgrade(transforms: readonly UpgradeTransform[] = UPGRADE_TRANSFORMS) {
  const auto = transforms.filter(t => t.mode === 'auto').length
  return {
    writes: false as const,
    transforms: [...transforms],
    summary: { auto, report: transforms.length - auto },
  }
}

function formatPlan(plan: ReturnType<typeof planUpgrade>): string {
  const lines = plan.transforms.map(t => `  ${t.mode.padEnd(6)}  ${t.from}  →  ${t.to}`)
  return [
    `evlog upgrade: ${plan.summary.auto} auto, ${plan.summary.report} to review`,
    ...lines,
    '',
    'No files were changed. Scanning and rewriting land in a follow-up.',
  ].join('\n')
}

/**
 * `evlog upgrade`: the v2 to v3 codemod.
 *
 * This is the scaffold: it lists the transforms the command will apply and
 * changes nothing. Detection (EVL-595) and the auto-fixes (EVL-594) plug into
 * the same table.
 */
export default defineEvlogCommand('upgrade', {
  meta: { name: 'upgrade', description: 'Plan the v2 to v3 rewrites (scaffold, no files changed yet)' },
  run({ args, ui }) {
    const plan = planUpgrade()
    ui.done({
      jsonMode: args.json,
      json: { ...plan },
      human: formatPlan(plan),
    })
  },
})
