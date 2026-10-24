import { createStyle, EXIT_FAIL, EXIT_OK } from '../core/output'
import { defineEvlogCommand, failWith } from '../lib/command'
import { formatUpgradeReport } from '../lib/upgrade/report'
import { runUpgrade } from '../lib/upgrade/run'

/**
 * `evlog upgrade`: migrate a project to the newest evlog major.
 *
 * Shows what it would change and exits 1 while anything is left. `--write`
 * applies the fixes and bumps `evlog` in package.json; it exits 1 only while
 * findings that need a person remain.
 */
export default defineEvlogCommand('upgrade', {
  meta: { name: 'upgrade', description: 'Migrate this project to the newest evlog major' },
  args: {
    write: { type: 'boolean', description: 'Apply the fixes (default: show them and change nothing)' },
    force: { type: 'boolean', description: 'With --write, run even when git has uncommitted changes' },
  },
  async run({ args, cli, log, ui }) {
    try {
      const { report, result } = await log.step(
        'upgrade',
        () => runUpgrade({ cwd: cli.cwd, write: args.write === true, force: args.force === true }),
        ({ report }) => ({ from: report.from, to: report.to, auto: report.summary.auto, report: report.summary.report }),
      )
      ui.done({ jsonMode: args.json, json: { ...report }, human: formatUpgradeReport(createStyle(cli), report, result) })
      const remaining = report.write ? report.summary.report : report.findings.length
      ui.exit(remaining > 0 ? EXIT_FAIL : EXIT_OK)
    } catch (error) {
      failWith(error, { args, log, ui })
    }
  },
})
