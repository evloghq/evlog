import { runCommand } from 'citty'
import { EXIT_FAIL, EXIT_USAGE, setExitCode, writeHuman, writeStdout } from './core/output'
import { resolveCommand, showUsage } from './core/usage'
import { VERSION } from './lib/constants'
import { main } from './index'

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
    await runCommand(main, { rawArgs })
  } catch (error) {
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
