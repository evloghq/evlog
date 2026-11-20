import { isCancel, select } from '@clack/prompts'
import { telemetry } from '@evlog/telemetry'
import { EvlogError } from 'evlog'
import { createStyle, EXIT_FAIL, EXIT_USAGE } from '../core/output'
import { defineEvlogCommand } from '../lib/command'
import { cliErrors, isUsageError } from '../lib/errors'
import { DEFAULT_VERCEL_CONNECTOR } from '../lib/logs/vercel'
import { runSetupVercel } from '../lib/setup-vercel'
import type { ListedConnector } from '../lib/setup-vercel'

async function chooseConnector(reusable: ListedConnector[], attached: ReadonlySet<string>): Promise<string | undefined> {
  const ordered = [...reusable].sort((a, b) => Number(attached.has(b.uid)) - Number(attached.has(a.uid)))
  const answer = await select({
    message: 'The team already has a Vercel API-key connector. Read logs through it?',
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
    target: { type: 'positional', required: true, description: 'What to set up: vercel' },
    connector: { type: 'string', description: 'The Vercel Connect connector to read through, such as vercel/mcp (default: logs.vercel.connector in evlog.config, else vercel/evlog)' },
  },
  async run({ args, cli, ui }) {
    const style = createStyle(cli)
    try {
      if (args.target !== 'vercel') throw cliErrors.SETUP_INVALID_TARGET({ value: String(args.target) })
      const result = await runSetupVercel(cli, {
        connector: args.connector,
        choose: cli.tty && !args.json ? chooseConnector : undefined,
        onStep: command => ui.human(style.paint('dim', `→ ${command}`)),
      })
      const steps = [
        `${result.connector} connector ${result.created ? 'created' : 'already on the team'}`,
        result.attached ? `attached to ${result.projectId} for production, preview and development` : `already attached to ${result.projectId}`,
        `read ${result.events} event${result.events === 1 ? '' : 's'} from the last hour of runtime logs`,
      ]
      ui.done({
        jsonMode: args.json,
        json: { ...result },
        human: [
          ...steps.map(step => `${style.paint('green', '✓')} ${step}`),
          '',
          ...(result.reused ? [`Add logs: { vercel: { connector: '${result.connector}' } } to evlog.config.ts so evlog logs reads through it`, ''] : []),
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
