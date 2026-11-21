import { isCancel, select, text } from '@clack/prompts'
import { telemetry } from '@evlog/telemetry'
import { EvlogError } from 'evlog'
import { createStyle, EXIT_FAIL, EXIT_USAGE } from '../core/output'
import { defineEvlogCommand } from '../lib/command'
import { cliErrors, isUsageError } from '../lib/errors'
import { runSetupEve } from '../lib/setup-eve'
import type { SetupEveResult } from '../lib/setup-eve'
import { runSetupVercel, runSetupVercelCheck } from '../lib/setup-vercel'
import type { ConnectorChoice, ListedConnector, PreflightStage } from '../lib/setup-vercel'

const MARK: Record<PreflightStage['status'], { mark: string, color: 'green' | 'yellow' | 'red' | 'dim' }> = {
  ok: { mark: '✓', color: 'green' },
  warn: { mark: '!', color: 'yellow' },
  fail: { mark: '✗', color: 'red' },
  skipped: { mark: '·', color: 'dim' },
}

const CREATE = Symbol('create')

async function chooseConnector(reusable: ListedConnector[], attached: ReadonlySet<string>): Promise<ConnectorChoice | undefined> {
  const ordered = [...reusable].sort((a, b) => Number(attached.has(b.uid)) - Number(attached.has(a.uid)))
  if (ordered.length > 0) {
    const answer = await select<string | typeof CREATE>({
      message: 'The team has Vercel API-key connectors that can read runtime logs. Use one? It gives this project\'s deployments the whole authority of the key it stores',
      options: [
        ...ordered.map(connector => ({ value: connector.uid, label: `Use ${connector.uid}`, hint: attached.has(connector.uid) ? 'attached to this project' : undefined })),
        { value: CREATE, label: 'Create a new connector', hint: 'asks for a Vercel access token' },
      ],
    })
    if (isCancel(answer)) return undefined
    if (answer !== CREATE) return { connector: answer, create: false }
  }
  const taken = new Set(reusable.map(connector => connector.uid))
  const name = await text({
    message: 'Name of the new Vercel connector',
    placeholder: 'evlog',
    validate: (value) => {
      const uid = `vercel/${value?.trim() ?? ''}`
      if (!/^vercel\/[a-z0-9][\w-]*$/i.test(uid)) return 'Letters, digits, - and _, starting with a letter or digit'
      if (taken.has(uid)) return `The team already has ${uid}`
      return undefined
    },
  })
  return isCancel(name) ? undefined : { connector: `vercel/${name.trim()}`, create: true }
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
    connector: { type: 'string', description: 'The Vercel Connect connector to read through, such as vercel/mcp (default: logs.vercel.connector in evlog.config; asked for when neither names one)' },
    create: { type: 'boolean', description: 'Create the --connector connector, such as --connector vercel/evlog --create, instead of using one the team has' },
    environment: { type: 'string', description: 'Environments to attach the connector for, separated by commas (default: production,development). Add preview only if every branch may use the key' },
  },
  async run({ args, cli, ui }) {
    const style = createStyle(cli)
    try {
      if (args.target === 'eve') {
        const results = await runSetupEve(cli, { check: args.check === true })
        const said = (eve: SetupEveResult): string => ({
          written: `${style.paint('green', '✓')} wrote ${eve.file}`,
          present: `${style.paint('green', '✓')} ${eve.file} already exports evlogTraces()`,
          missing: `${style.paint('yellow', '!')} ${eve.file} is missing; evlog setup eve writes it`,
          conflict: `${style.paint('yellow', '!')} ${eve.file} exists without evlogTraces(); left as it is. Add: export default evlogTraces() from '@evlog/eve/instrumentation'`,
        })[eve.state]
        ui.done({ jsonMode: args.json, json: { agents: results }, human: results.map(said).join('\n') })
        if (results.some(eve => eve.state === 'conflict' || eve.state === 'missing')) ui.exit(EXIT_FAIL)
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
        create: args.create === true,
        environments: typeof args.environment === 'string' ? args.environment.split(',').map(name => name.trim()) : undefined,
        choose: cli.tty && !args.json ? chooseConnector : undefined,
        onStep: command => ui.human(style.paint('dim', `→ ${command}`)),
      })
      const written = result.config!
      const config = {
        created: `wrote ${written.file} with logs.vercel.connector`,
        updated: `set logs.vercel.connector in ${written.file}`,
        unchanged: `${written.file} already names it in logs.vercel.connector`,
        manual: '',
      }[written.state]
      const steps = [
        `${result.connector} connector ${result.created ? 'created' : 'already on the team'}`,
        ...(config ? [config] : []),
        result.attached ? `attached to ${result.projectId} for ${result.environments!.join(', ')}` : `already attached to ${result.projectId}, left as it is; its environments are in the project's Connect tab`,
        `read ${result.events} event${result.events === 1 ? '' : 's'} from the last hour of runtime logs`,
      ]
      ui.done({
        jsonMode: args.json,
        json: { ...result },
        human: [
          ...steps.map(step => `${style.paint('green', '✓')} ${step}`),
          '',
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
