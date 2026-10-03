import { EXIT_FAIL } from '../core/output'
import { defineEvlogCommand, failWith } from '../lib/command'
import { cliErrors } from '../lib/errors'
import { askWorkspaceTargets, canPrompt, closeCancelled, InitCancelled } from '../lib/init/prompts'
import { formatInitReport, formatWorkspaceHeading } from '../lib/init/report'
import {
  parseDrainArg,
  parseEnrichersArg,
  parseExtrasArg,
  parseProdDrainsArg,
  parseSamplingArg,
} from '../lib/init/resolve'
import { runInit } from '../lib/init/run'
import type { InitOptions, InitResult } from '../lib/init/run'
import { findWorkspaceApps, isWorkspaceRoot } from '../lib/init/workspace'
import { INIT_FRAMEWORK_IDS, isInitFramework } from '../lib/frameworks'
import { resolveProject } from '../lib/project'
import type { Framework } from '../lib/map/types'

function parseFrameworkArg(value: unknown): Framework | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  if (!isInitFramework(value)) {
    throw cliErrors.INIT_INVALID_FRAMEWORK({ value })
  }
  return value
}

function parseServiceArg(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  return value.trim()
}

/**
 * `evlog init` — wire evlog into the project it is run in.
 *
 * Interactive by default and fully driveable by flags, because both callers are
 * real: a person picking destinations from a list, and an agent that must never
 * be left waiting on a keystroke. `--json`, `--yes`, a non-TTY stdin, or `CI`
 * all select the second path.
 *
 * The other commands score and diagnose; this one writes application code, so
 * it is deliberately conservative: it appends to configs, never rewrites them,
 * skips any file that already exists, and shows the plan before applying it.
 */
export default defineEvlogCommand('init', {
  meta: { name: 'init' },
  /* The clack session draws its own intro; two banners read as two programs. */
  skipHeader: (ctx, args) => args.json !== true && args.yes !== true && canPrompt(ctx),
  args: {
    framework: { type: 'string', description: `Override framework detection (${INIT_FRAMEWORK_IDS.join(', ')})` },
    service: { type: 'string', description: 'Service name on every wide event (default: package name)' },
    drain: { type: 'string', description: 'Development sink: fs (default) or none' },
    prodDrain: { type: 'string', description: 'Production destinations, comma-separated: axiom, otlp, posthog, sentry, better-stack, datadog, hyperdx' },
    extras: { type: 'string', description: 'Comma-separated: enrichers, pipeline, sampling, vite, error-catalog, audit-catalog, ai, better-auth' },
    enrichers: { type: 'string', description: 'Comma-separated: user-agent, geo, request-size, trace-context (default: all)' },
    sampling: { type: 'string', description: 'Traffic tier: all, low, medium (default), high, very-high' },
    apps: { type: 'string', description: 'Workspace packages to set up, comma-separated (monorepo root only)' },
    yes: { type: 'boolean', alias: 'y', description: 'Skip every question and take the defaults' },
    dryRun: { type: 'boolean', description: 'Show what would change without writing anything' },
    // citty negations: declared positive so `--no-install` works.
    install: { type: 'boolean', default: true, description: 'Install evlog when missing (--no-install to skip)' },
    agents: { type: 'boolean', default: true, description: 'Write the AGENTS.md block and install the skills (--no-agents to skip)' },
  },
  async run({ args, cli, log, ui }) {
    let options: InitOptions
    try {
      options = {
        framework: parseFrameworkArg(args.framework),
        service: parseServiceArg(args.service),
        devDrain: parseDrainArg(args.drain),
        prodDrains: parseProdDrainsArg(args.prodDrain),
        extras: parseExtrasArg(args.extras),
        enrichers: parseEnrichersArg(args.enrichers),
        sampling: parseSamplingArg(args.sampling),
        dryRun: args.dryRun,
        install: args.install,
        agentGuide: args.agents,
        yes: args.yes,
        /* JSON output and a prompt cannot share a terminal: the payload is the
           contract, and half a TUI on stderr in front of it helps nobody. */
        nonInteractive: args.json === true,
      }
    } catch (error) {
      return failWith(error, { args, log, ui })
    }

    /* A monorepo root has no entry points of its own, so `init` there means
       "set up the apps", not "wire this package". */
    const project = await resolveProject(cli.cwd)
    const targets = isWorkspaceRoot(project) ? findWorkspaceApps(project) : []

    if (targets.length > 0) {
      const requested = typeof args.apps === 'string' && args.apps.length > 0
        ? args.apps.split(',').map(entry => entry.trim()).filter(Boolean)
        : null

      if (requested) {
        /* A name that matches nothing has to stop the run even when its
           neighbours matched. `--apps web,shopp` setting up `web` and saying
           nothing about `shopp` is the silent-default behaviour every other
           flag here refuses. */
        const unknown = requested.filter(
          entry => !targets.some(app => app.label === entry || app.name === entry),
        )
        if (unknown.length > 0) {
          return failWith(
            cliErrors.INIT_NO_APPS({ value: unknown.join(', '), known: targets.map(app => app.label).join(', ') }),
            { args, log, ui },
          )
        }
      }

      let selected = requested
        ? targets.filter(app => requested.includes(app.label) || requested.includes(app.name))
        : targets

      /* Without `--apps`, a terminal gets to choose. Setting up every package in
         a monorepo because the command was run from the root is the kind of
         helpfulness that produces a revert. */
      if (!requested && args.json !== true && args.yes !== true && canPrompt(cli)) {
        try {
          const chosen = await askWorkspaceTargets(targets)
          selected = targets.filter(app => chosen.includes(app.dir))
        } catch (error) {
          if (error instanceof InitCancelled) {
            closeCancelled()
            return
          }
          throw error
        }
      }

      if (selected.length === 0) {
        return failWith(
          cliErrors.INIT_NO_APPS({ value: 'nothing', known: targets.map(app => app.label).join(', ') }),
          { args, log, ui },
        )
      }

      const results: InitResult[] = []
      for (const app of selected) {
        if (!args.json) ui.human(formatWorkspaceHeading(cli, app.label))
        try {
          const result = await runInit({ ...cli, cwd: app.dir }, log, { ...options, framework: app.framework })
          results.push(result)
          if (!args.json && !result.interactive) ui.human(formatInitReport(cli, result))
        } catch (error) {
          /* Ctrl-C in the middle of a workspace run stops the loop rather than
             throwing past it: the apps already set up keep what they got, and
             the ones after are simply not touched. */
          if (error instanceof InitCancelled) {
            closeCancelled()
            break
          }
          return failWith(error, { args, log, ui })
        }
      }

      ui.done({
        jsonMode: args.json,
        json: { workspace: true, apps: results.map((result, index) => ({ app: selected[index]!.label, ...toJson(result) })) },
      })
      if (results.some(result => result.install.status === 'failed')) ui.exit(EXIT_FAIL)
      return
    }

    let result: InitResult
    try {
      result = await runInit(cli, log, options)
    } catch (error) {
      return failWith(error, { args, log, ui })
    }

    ui.done({
      jsonMode: args.json,
      json: toJson(result),
      /* The interactive flow already narrated itself; printing the report after
         it would repeat the whole run under the outro. */
      human: result.interactive ? undefined : formatInitReport(cli, result),
    })

    if (result.install.status === 'failed') {
      ui.exit(EXIT_FAIL)
    }
  },
})

function toJson(result: InitResult): Record<string, unknown> {
  return {
    framework: result.answers.framework,
    service: result.answers.service,
    devDrain: result.answers.devDrain,
    prodDrains: result.answers.prodDrains,
    extras: result.answers.extras,
    enrichers: result.answers.enrichers,
    sampling: result.answers.sampling,
    packageManager: result.packageManager,
    install: result.install,
    written: result.written.map(action => ({ file: action.relative, kind: action.kind })),
    already: result.already,
    manual: result.manual.map(step => ({ title: step.title, file: step.file, reason: step.reason })),
    dropped: result.dropped,
    insight: result.insight,
    verified: result.verified,
    agentGuide: result.agentGuide,
    dryRun: result.dryRun,
    cancelled: result.cancelled,
  }
}
