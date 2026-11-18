import type { EvlogError } from 'evlog'
import { useLogger } from '@evlog/eve/logger'
import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { eviErrors, refusal } from '../lib/errors'
import { parseLintReport } from '../lib/content/scan'
import type { LintPage } from '../lib/content/selection'
import { cooldownCommand, selectTargets, touchedPaths } from '../lib/content/selection'
import { REPO_DIR, runOutput } from '../lib/workspace'

const DEFAULT_COOLDOWN_DAYS = 14

/**
 * Read-only, so it stays visible on every turn: the daily content pass runs
 * unattended, and a pass that cannot see its targets does nothing at all.
 */
export default defineTool({
  description: `Pick the files the next content pass should work on. Runs the repository's content-lint over every written surface in ${REPO_DIR} (docs pages, the landing, the package READMEs, the skills, the AGENTS.md files), drops files changed inside the cooldown window, and returns the highest-priority files from a single group with their findings. Criticals (a broken import, a dead link) outrank a low score. Landing findings come back as \`report\` rather than \`rewrite\`, and so does anything on a skill or an AGENTS.md that is not a house rule, because those files govern the agent running the pass. Pass \`surface\` to work one kind of file. Also returns \`candidates\` (files with findings) and \`eligible\` (those outside the cooldown): the rewrite half is empty only when \`eligible\` is 0, whatever the top of the ranking looks like. Call this before reviewing or rewriting anything; the findings it returns are candidates to judge against the write-evlog-content skill, not verdicts.`,
  inputSchema: z.object({
    limit: z.number().int().min(1).max(8).optional().describe('How many files this pass may open. Default 5.'),
    cooldownDays: z.number().int().min(1).max(90).optional().describe(`Days a file rests after any change touches it. Default ${DEFAULT_COOLDOWN_DAYS}.`),
    surface: z.enum(['docs', 'reference', 'landing', 'blog', 'readme', 'skill', 'agents']).optional().describe('Restrict the scan to one surface. Omit to rank the whole corpus.'),
  }),
  async execute(input, toolCtx) {
    const sandbox = await toolCtx.getSandbox()
    const log = useLogger()
    const refuse = (error: EvlogError) => {
      const refused = refusal(error)
      log.set({ content: { scanned: false, reason: refused.code } })
      return refused
    }
    const cooldownDays = input.cooldownDays ?? DEFAULT_COOLDOWN_DAYS
    const surface = input.surface ? ` --surface ${input.surface}` : ''

    const scan = await sandbox.run({
      command: `cd ${REPO_DIR} && node scripts/content-lint/index.mjs --json${surface}`,
    })
    if (scan.exitCode !== 0) {
      return refuse(eviErrors.CONTENT_SCAN_FAILED({ message: `content-lint exited ${scan.exitCode}: ${runOutput(scan)}` }))
    }
    const report = parseLintReport(scan.stdout)
    if (report === null) {
      return refuse(eviErrors.CONTENT_SCAN_FAILED({ message: 'content-lint returned no JSON pages array.' }))
    }

    const history = await sandbox.run({ command: cooldownCommand(REPO_DIR, cooldownDays) })
    if (history.exitCode !== 0) {
      return refuse(eviErrors.GIT_COMMAND_FAILED({ command: 'log', exitCode: history.exitCode, message: `git log exited ${history.exitCode}: ${runOutput(history)}` }))
    }

    const selection = selectTargets({
      pages: report.pages as LintPage[],
      recentlyTouched: touchedPaths(String(history.stdout)),
      limit: input.limit,
    })

    log.set({
      content: {
        scanned: report.pages.length,
        candidates: selection.candidates,
        eligible: selection.eligible,
        targets: selection.targets.length,
        ...(selection.group ? { group: selection.group } : {}),
        ...(input.surface ? { surface: input.surface } : {}),
      },
    })

    return {
      success: true as const,
      baseline: report.baseline,
      scanned: report.pages.length,
      cooldownDays,
      // `eligible` is the only number that decides whether the rewrite half
      // has work: zero means empty, anything else means targets exist.
      candidates: selection.candidates,
      eligible: selection.eligible,
      group: selection.group,
      targets: selection.targets,
      held: selection.held.slice(0, 10),
    }
  },
})
