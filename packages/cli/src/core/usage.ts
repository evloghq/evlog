import type { ArgsDef, CommandDef, Resolvable } from 'citty'
import { formatBanner } from './brand'
import { createContext } from './context'
import { createStyle, writeHuman, writeStdout } from './output'

export async function resolve<T>(value: T | (() => T | Promise<T>) | Promise<T> | undefined): Promise<T | undefined> {
  if (typeof value === 'function') return await (value as () => T | Promise<T>)()
  return await value
}

/**
 * The command `rawArgs` leads to and the commands above it, root first, the
 * pair {@link showUsage} takes: `telemetry status --help` is `status` under
 * the root and `telemetry`, an unknown name stays on the command that did not
 * know it.
 */
export async function resolveCommand(
  cmd: CommandDef<any>,
  rawArgs: string[],
  parents: CommandDef<any>[] = [],
): Promise<[CommandDef<any>, CommandDef<any>[]]> {
  const subCommands = await resolve(cmd.subCommands)
  const index = rawArgs.findIndex(arg => !arg.startsWith('-'))
  const sub = index === -1 ? undefined : subCommands?.[rawArgs[index]!]
  if (!sub) return [cmd, parents]
  return resolveCommand(await resolve(sub as Resolvable<CommandDef<any>>) as CommandDef<any>, rawArgs.slice(index + 1), [...parents, cmd])
}

interface Row {
  name: string
  description: string
}

function formatSection(title: string, rows: Row[], paint: ReturnType<typeof createStyle>['paint']): string {
  const width = Math.max(...rows.map(r => r.name.length))
  const lines = rows.map(row => `  ${paint('blue', '│')} ${paint(['cyan', 'bold'], row.name.padEnd(width))}  ${row.description}`)
  return `  ${paint('dim', title)}\n\n${lines.join('\n')}`
}

/** The spelling a flag is typed in: `dryRun` is declared, `--dry-run` is written. */
function flagName(key: string): string {
  return `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
}

/**
 * Branded replacement for citty's default usage renderer — banner on top,
 * blue-railed command, argument and option lists, no repeated boilerplate: the
 * docs link lives in the banner meta line only.
 *
 * @param to - `stdout` when the usage was asked for with `--help`, so it can be
 * piped; `stderr` when it comes with an error.
 */
export async function showUsage(cmd: CommandDef<any>, parents: CommandDef<any>[], to: 'stdout' | 'stderr'): Promise<void> {
  const ctx = createContext({}, process[to])
  const { paint } = createStyle(ctx)

  const metas = await Promise.all([...parents, cmd].map(c => resolve(c.meta)))
  const commandName = metas.map(m => m?.name).filter(Boolean).join(' ') || 'evlog'
  const version = metas.findLast(m => m?.version)?.version ?? ''

  const subCommands = await resolve(cmd.subCommands)
  const args = Object.entries(await resolve(cmd.args as ArgsDef | undefined) ?? {})
  const positionals = args.filter(([, def]) => def.type === 'positional')
  const options = args.filter(([, def]) => def.type !== 'positional')
  const hasCommands = !!subCommands && Object.keys(subCommands).length > 0

  const sections: string[] = [formatBanner(ctx, version).trimEnd()]

  const usageParts = [commandName]
  if (hasCommands) usageParts.push('<command>')
  for (const [name, def] of positionals) usageParts.push(def.required === false ? `[${name}]` : `<${name}>`)
  if (options.length > 0) usageParts.push('[options]')
  sections.push(`  ${paint('dim', 'USAGE')}  ${paint('bold', usageParts.join(' '))}`)

  if (hasCommands) {
    const rows: Row[] = []
    for (const [name, sub] of Object.entries(subCommands)) {
      const subMeta = await resolve((await resolve(sub as Resolvable<CommandDef>))?.meta)
      rows.push({ name, description: subMeta?.description ?? '' })
    }
    sections.push(formatSection('COMMANDS', rows, paint))
  }

  if (positionals.length > 0) {
    sections.push(formatSection('ARGUMENTS', positionals.map(([name, def]) => ({ name, description: def.description ?? '' })), paint))
  }

  if (options.length > 0) {
    const rows: Row[] = options.map(([name, def]) => {
      const short = 'alias' in def ? [def.alias ?? []].flat().map(alias => `-${alias}, `).join('') : ''
      return { name: `${short}${flagName(name)}`, description: def.description ?? '' }
    })
    sections.push(formatSection('OPTIONS', rows, paint))
  }

  if (hasCommands) {
    sections.push(`  ${paint('dim', `Use ${commandName} <command> --help for details`)}`)
  }

  // One blank line between major sections; no leading spacer above the banner
  const text = `${sections.join('\n\n')}\n`
  if (to === 'stdout') writeStdout(text)
  else writeHuman(text)
}
