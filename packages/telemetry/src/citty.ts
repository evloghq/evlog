import type { ArgsDef, CommandDef, Resolvable, SubCommandsDef } from 'citty'
import { createTelemetry } from './create'
import type { CollectFields, CollectFlags, FlagDefinitions, TelemetryHandle, TelemetryOptions } from './types'

type AnyCommand = CommandDef<ArgsDef>
type Runner = Pick<TelemetryHandle, 'run'>

async function resolve<T>(value: Resolvable<T>): Promise<T> {
  return typeof value === 'function' ? await (value as () => T | Promise<T>)() : await value
}

/** Plain objects are wrapped now; lazy ones when citty resolves them, so unused commands never load. */
function wrapSubCommands(
  subCommands: Resolvable<SubCommandsDef>,
  telemetry: Runner,
  path: string[],
): Resolvable<SubCommandsDef> {
  const wrapAll = (subs: SubCommandsDef): SubCommandsDef => Object.fromEntries(
    Object.entries(subs).map(([key, sub]) => [
      key,
      typeof sub === 'function' || sub instanceof Promise
        ? async () => wrapCommand(await resolve(sub), telemetry, path)
        : wrapCommand(sub, telemetry, path),
    ]),
  )
  return typeof subCommands === 'function' || subCommands instanceof Promise
    ? async () => wrapAll(await resolve(subCommands))
    : wrapAll(subCommands)
}

function wrapCommand(
  command: AnyCommand,
  telemetry: Runner,
  path: string[],
  isRoot = false,
): AnyCommand {
  const meta = command.meta && typeof command.meta === 'object' && !('then' in command.meta) ? command.meta : undefined
  const segment = meta?.name
  const commandPath = isRoot && command.subCommands
    ? path
    : segment
      ? [...path, segment]
      : path

  /* citty resolves `args` once to parse argv, then calls `run`. The event
     needs the same definitions to tell a defaulted flag from a passed one, so
     the value citty resolved is kept rather than resolving a second time: a
     function-valued resolver may not be idempotent, and a rejection from it
     must not stop the command when telemetry is off. */
  let resolvedArgs: ArgsDef | undefined
  const args = command.args === undefined
    ? undefined
    : async () => {
      resolvedArgs = await resolve(command.args!)
      return resolvedArgs
    }

  return {
    ...command,
    args,
    subCommands: command.subCommands ? wrapSubCommands(command.subCommands, telemetry, commandPath) : undefined,
    run: command.run
      ? (ctx) => {
        const name = commandPath.join(' ') || segment || 'run'
        return telemetry.run(name, () => command.run!(ctx), {
          flags: ctx.args as Record<string, unknown>,
          args: resolvedArgs as FlagDefinitions | undefined,
        })
      }
      : command.run,
  }
}

/**
 * Wrap a citty command tree with telemetry — one wide event per command execution.
 * Lazily loaded subcommands (`() => import('./cmd').then(m => m.default)`) stay lazy.
 * Returns the wrapped command for `runMain()`.
 */
export function withTelemetry<
  const TArgs extends ArgsDef = ArgsDef,
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
>(
  command: CommandDef<TArgs>,
  options: TelemetryOptions<TFlags, TFields>,
): CommandDef<TArgs> {
  const instance = createTelemetry(options)
  return wrapCommand(command as AnyCommand, instance, [], true) as CommandDef<TArgs>
}
