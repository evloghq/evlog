import { EXIT_FAIL } from '../core/output'
import { formatAgentsReport } from '../lib/agents/report'
import { runAgents } from '../lib/agents/run'
import type { AgentsOptions, AgentsResult } from '../lib/agents/run'
import { defineEvlogCommand, failWith } from '../lib/command'
import { canPrompt } from '../lib/init/prompts'

function parseSkillsArg(value: unknown): { skills: string[], noSkills: boolean } {
  if (value === false) return { skills: [], noSkills: true }
  if (typeof value !== 'string' || value.length === 0) return { skills: [], noSkills: false }
  return { skills: value.split(',').map(entry => entry.trim()).filter(Boolean), noSkills: false }
}

/**
 * `evlog agents` — teach the agents working in this project how to use evlog.
 *
 * Wiring evlog in is half the job: the other half is the assistant writing the
 * handlers, which will keep reaching for `console.log` until something in the
 * repository tells it not to. This writes that something — a marker-delimited
 * block in `AGENTS.md`, and a `CLAUDE.md` that points at it.
 *
 * The skills themselves are handed to `npx skills add`. Every agent reads a
 * different directory and that CLI already resolves them, so copying the files
 * ourselves would produce a second set nothing could update.
 */
export default defineEvlogCommand('agents', {
  meta: { name: 'agents' },
  /* The clack session draws its own intro; two banners read as two programs. */
  skipHeader: (ctx, args) => args.json !== true && args.yes !== true && canPrompt(ctx),
  args: {
    // citty negations: declared positive so `--no-skills` works.
    skills: { type: 'string', default: '', description: 'Skills to install, comma-separated (--no-skills for the AGENTS.md block alone)' },
    global: { type: 'boolean', alias: 'g', description: 'Install the skills for every project instead of this one' },
    source: { type: 'string', description: 'Where the skills are published (default: https://www.evlog.dev)' },
    yes: { type: 'boolean', alias: 'y', description: 'Apply without confirming' },
    dryRun: { type: 'boolean', description: 'Show what would change without writing anything' },
  },
  async run({ args, cli, log, ui }) {
    const { skills, noSkills } = parseSkillsArg(args.skills)

    const options: AgentsOptions = {
      skills,
      noSkills,
      global: args.global,
      source: typeof args.source === 'string' && args.source.length > 0 ? args.source : undefined,
      dryRun: args.dryRun,
      yes: args.yes,
      /* JSON output and a prompt cannot share a terminal: the payload is the
         contract, and half a TUI on stderr in front of it helps nobody. */
      nonInteractive: args.json === true,
    }

    let result: AgentsResult
    try {
      result = await runAgents(cli, log, options)
    } catch (error) {
      return failWith(error, { args, log, ui })
    }

    ui.done({
      jsonMode: args.json,
      json: toJson(result),
      /* The interactive flow already narrated itself through clack. */
      human: result.interactive ? undefined : formatAgentsReport(cli, result),
    })

    if (result.skills.status === 'failed') {
      ui.exit(EXIT_FAIL)
    }
  },
})

function toJson(result: AgentsResult): Record<string, unknown> {
  return {
    framework: result.framework,
    skills: result.skills,
    written: result.written.map(action => ({ file: action.relative, kind: action.kind })),
    already: result.already,
    dryRun: result.dryRun,
    cancelled: result.cancelled,
  }
}
