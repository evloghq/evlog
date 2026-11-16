import { runCommand } from 'citty'
import type { ArgsDef, CommandDef, Resolvable } from 'citty'
import { EvlogError } from 'evlog'
import { EXIT_FAIL, EXIT_USAGE, setExitCode, writeHuman, writeStdout } from './core/output'
import { resolve, resolveCommand, showUsage } from './core/usage'
import { VERSION } from './lib/constants'
import { isUsageError } from './lib/errors'
import { checkFlags } from './lib/flags'
import { main } from './index'

/**
 * Check the flags written before a subcommand's name against the command they
 * were given to, down to the leaf, which checks its own.
 *
 * citty hands a subcommand only what follows its name, so nothing else reads
 * the flag in `evlog --dry-run init`, and `init` would run for real.
 */
async function checkGroupFlags(cmd: CommandDef<any>, rawArgs: string[]): Promise<void> {
  const subCommands = await resolve(cmd.subCommands)
  if (!subCommands || Object.keys(subCommands).length === 0) return
  const index = rawArgs.findIndex(arg => !arg.startsWith('-'))
  checkFlags(index === -1 ? rawArgs : rawArgs.slice(0, index), await resolve(cmd.args as ArgsDef | undefined) ?? {})
  const sub = index === -1 ? undefined : subCommands[rawArgs[index]!]
  if (sub) await checkGroupFlags(await resolve(sub as Resolvable<CommandDef<any>>) as CommandDef<any>, rawArgs.slice(index + 1))
}

/**
 * Run the CLI on `rawArgs` and set the exit code.
 *
 * In place of citty's `runMain`, which exits 1 whatever went wrong: an unknown
 * command, or a group called without a subcommand, is a usage error and exits 2
 * like an unknown flag does.
 */
export async function run(rawArgs: string[]): Promise<void> {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    await showUsage(...await resolveCommand(main, rawArgs))
    return
  }
  if (rawArgs.length === 1 && (rawArgs[0] === '--version' || rawArgs[0] === '-v')) {
    writeStdout(VERSION)
    return
  }

  try {
    await checkGroupFlags(main, rawArgs)
    await runCommand(main, { rawArgs })
  } catch (error) {
    if (error instanceof EvlogError && isUsageError(error)) {
      writeHuman(error.fix ? `${error.message}\n→ ${error.fix}` : error.message)
      setExitCode(EXIT_USAGE)
      return
    }
    if (error instanceof Error && error.name === 'CLIError') {
      await showUsage(...await resolveCommand(main, rawArgs))
      writeHuman(error.message)
      setExitCode(EXIT_USAGE)
      return
    }
    console.error(error, '\n')
    setExitCode(EXIT_FAIL)
  }
}
