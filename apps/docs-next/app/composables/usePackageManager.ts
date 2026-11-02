export const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const
export type PackageManager = typeof PACKAGE_MANAGERS[number]

/** The reader's package manager, kept in a cookie so the server renders their commands. */
export function usePackageManager() {
  return useCookie<PackageManager>('docs-pm', { default: () => 'pnpm', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
}

export interface CommandLine {
  /** The executable: `pnpm`, `npx`, `bunx`... */
  bin: string
  /** The subcommand, when the manager has one: `add`, `install`, `dlx`. */
  verb?: string
  rest: string
}

const ADD = { pnpm: ['pnpm', 'add'], npm: ['npm', 'install'], yarn: ['yarn', 'add'], bun: ['bun', 'add'] } as const
const DLX = { pnpm: ['pnpm', 'dlx'], npm: ['npx'], yarn: ['yarn', 'dlx'], bun: ['bunx'] } as const

/**
 * Rewrites a docs command written for pnpm (`pnpm add x`, `pnpm dlx x`) for another manager.
 * Returns undefined for any line that is not one of those two shapes.
 */
export function toPackageManager(line: string, pm: PackageManager): CommandLine | undefined {
  const match = line.match(/^pnpm (add|dlx) (.+)$/)
  if (!match) return undefined
  const [bin, verb] = (match[1] === 'add' ? ADD : DLX)[pm]
  return { bin: bin!, verb, rest: match[2]! }
}
