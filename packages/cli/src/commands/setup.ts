import { isCancel, select } from '@clack/prompts'
import { telemetry } from '@evlog/telemetry'
import { EvlogError } from 'evlog'
import { createStyle, EXIT_FAIL, EXIT_USAGE } from '../core/output'
import { defineEvlogCommand } from '../lib/command'
import { cliErrors, isUsageError } from '../lib/errors'
import { DEFAULT_VERCEL_CONNECTOR } from '../lib/logs/vercel'
import { runSetupEve } from '../lib/setup-eve'
import { runSetupVercel, runSetupVercelCheck } from '../lib/setup-vercel'
import type { ListedConnector, PreflightStage } from '../lib/setup-vercel'

const MARK: Record<PreflightStage['status'], { mark: string, color: 'green' | 'yellow' | 'red' | 'dim' }> = {
  ok: { mark: '✓', color: 'green' },
  warn: { mark: '!', color: 'yellow' },
  fail: { mark: '✗', color: 'red' },
  skipped: { mark: '·', color: 'dim' },
}

async function chooseConnector(reusable: ListedConnector[], attached: ReadonlySet<string>): Promise<string | undefined> {
  const ordered = [...reusable].sort((a, b) => Number(attached.has(b.uid)) - Number(attached.has(a.uid)))
  const answer = await select({
    message: 'The team already has a Vercel API-key connector. Read logs through it? Reusing one gives this project\'s deployments the whole authority of the key it stores',
    options: [
      ...ordered.map(connector => ({ value: connector.uid, label: `Reuse ${connector.uid}`, hint: attached.has(connector.uid) ? 'attached to this project' : undefined })),
      { value: DEFAULT_VERCEL_CONNECTOR, label: `Create ${DEFAULT_VERCEL_CONNECTOR}`, hint: 'asks for a new Vercel access token' },
    ],
  })
  return isCancel(answer) ? undefined : answer
}

/**
 * `evlog setup vercel` — let a Vercel project, and the agent deployed on it,
 * read its own runtime logs. Logic lives in {@link runSetupVercel}.
 */
export default defineEvlogCommand('setup', {
  meta: { name: 'setup' },
  args: {
    target: { type: 'positional', required: true, description: 'What to set up: vercel, or eve for an eve agent\'s trace instrumentation' },
    check: { type: 'boolean', description: 'Report each stage without changing anything: link, OIDC, connector, attachment, token, log read, traces' },
    connector: { type: 'string', description: 'The Vercel Connect connector to read through, such as vercel/mcp (default: logs.vercel.connector in evlog.config, else vercel/evlog)' },
    environment: { type: 'string', description: 'Environments to attach the connector for, separated by commas (default: production,development). Add preview only if every branch may use the key' },
  },
  async run({ args, cli, ui }) {
    const style = createStyle(cli)
    try {
      if (args.target === 'eve') {
        const eve = await runSetupEve(cli, { check: args.check === true })
        const said = {
          written: `${style.paint('green', '✓')} wrote ${eve.file}`,
          present: `${style.paint('green', '✓')} ${eve.file} already exports evlogTraces()`,
          missing: `${style.paint('yellow', '!')} ${eve.file} is missing; evlog setup eve writes it`,
          conflict: `${style.paint('yellow', '!')} ${eve.file} exists without evlogTraces(); left as it is. Add: export default evlogTraces() from '@evlog/eve/instrumentation'`,
        }[eve.state]
        ui.done({ jsonMode: args.json, json: { ...eve }, human: said })
        if (eve.state === 'conflict' || eve.state === 'missing') ui.exit(EXIT_FAIL)
        return
      }
      if (args.target !== 'vercel') throw cliErrors.SETUP_INVALID_TARGET({ value: String(args.target) })
      if (args.check) {
        const stages = await runSetupVercelCheck(cli, { connector: args.connector })
        ui.done({
          jsonMode: args.json,
          json: { stages, ready: stages.every(stage => stage.status === 'ok' || stage.status === 'warn') },
          human: [
            ...stages.flatMap(stage => [
              `${style.paint(MARK[stage.status].color, MARK[stage.status].mark)} ${stage.id.padEnd(9)} ${stage.message}`,
              ...(stage.fix ? [style.paint('dim', `  → ${stage.fix}`)] : []),
            ]),
            '',
            style.paint('dim', 'Read-only: nothing was created, attached or written'),
          ].join('\n'),
        })
        if (stages.some(stage => stage.status === 'fail')) ui.exit(EXIT_FAIL)
        return
      }
      const result = await runSetupVercel(cli, {
        connector: args.connector,
        environments: typeof args.environment === 'string' ? args.environment.split(',').map(name => name.trim()) : undefined,
        choose: cli.tty && !args.json ? chooseConnector : undefined,
        onStep: command => ui.human(style.paint('dim', `→ ${command}`)),
      })
      const steps = [
        `${result.connector} connector ${result.created ? 'created' : 'already on the team'}`,
        result.attached ? `attached to ${result.projectId} for ${result.environments!.join(', ')}` : `already attached to ${result.projectId}, left as it is; its environments are in the project's Connect tab`,
        `read ${result.events} event${result.events === 1 ? '' : 's'} from the last hour of runtime logs`,
      ]
      ui.done({
        jsonMode: args.json,
        json: { ...result },
        human: [
          ...steps.map(step => `${style.paint('green', '✓')} ${step}`),
          '',
          ...(result.reused
            ? [`Add logs: { vercel: { connector: '${result.connector}' } } to evlog.config.ts, and to the evlog mount of an eve agent, so reads go through it`, '']
            : []),
          style.paint('dim', 'evlog logs --source vercel reads them from here; deployed agents read them through the same connector'),
        ].join('\n'),
      })
    } catch (error) {
      if (error instanceof EvlogError) {
        telemetry.fail(error.code)
        ui.done({
          jsonMode: args.json,
          json: { error: { code: error.code, message: error.message, why: error.why, fix: error.fix } },
          human: error.fix ? `${error.message}\n→ ${error.fix}` : error.message,
        })
        ui.exit(isUsageError(error) ? EXIT_USAGE : EXIT_FAIL)
        return
      }
      throw error
    }
  },
})
