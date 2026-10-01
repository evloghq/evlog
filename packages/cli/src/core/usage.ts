import type { ArgsDef, CommandDef, Resolvable } from 'citty'
import { formatBanner } from './brand'
import { createContext } from './context'
import { createStyle, writeHuman } from './output'

async function resolve<T>(value: T | (() => T | Promise<T>) | Promise<T> | undefined): Promise<T | undefined> {
  if (typeof value === 'function') return await (value as () => T | Promise<T>)()
  return await value
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

/**
 * Branded replacement for citty's default usage renderer — banner on top,
 * blue-railed command and option lists, no repeated boilerplate: the docs
 * link lives in the banner meta line only.
 */
export async function showUsage(cmd: CommandDef<any>, parent?: CommandDef<any>): Promise<void> {
  const ctx = createContext()
  const { paint } = createStyle(ctx)

  const meta = await resolve(cmd.meta)
  const parentMeta = await resolve(parent?.meta)
  const commandName = [parentMeta?.name, meta?.name].filter(Boolean).join(' ') || 'evlog'
  const version = meta?.version ?? parentMeta?.version ?? ''

  const subCommands = await resolve(cmd.subCommands)
  const args = await resolve(cmd.args as ArgsDef | undefined)
  const hasCommands = !!subCommands && Object.keys(subCommands).length > 0
  const hasArgs = !!args && Object.keys(args).length > 0

  const sections: string[] = [formatBanner(ctx, version).trimEnd()]

  const usageParts = [commandName]
  if (hasCommands) usageParts.push('<command>')
  if (hasArgs) usageParts.push('[options]')
  sections.push(`  ${paint('dim', 'USAGE')}  ${paint('bold', usageParts.join(' '))}`)

  if (hasCommands) {
    const rows: Row[] = []
    for (const [name, sub] of Object.entries(subCommands)) {
      const subMeta = await resolve((await resolve(sub as Resolvable<CommandDef>))?.meta)
      rows.push({ name, description: subMeta?.description ?? '' })
    }
    sections.push(formatSection('COMMANDS', rows, paint))
  }

  if (hasArgs) {
    const rows: Row[] = Object.entries(args).map(([name, def]) => ({
      name: `--${name}`,
      description: (def as { description?: string }).description ?? '',
    }))
    sections.push(formatSection('OPTIONS', rows, paint))
  }

  if (hasCommands) {
    sections.push(`  ${paint('dim', `Use ${commandName} <command> --help for details`)}`)
  }

  // One blank line between major sections; no leading spacer above the banner
  writeHuman(`${sections.join('\n\n')}\n`)
}
