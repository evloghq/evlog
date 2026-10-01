import type { CommandDef, SubCommandsDef } from 'citty'

const load = (module: Promise<{ default: unknown }>) => module.then(m => m.default as CommandDef)

/**
 * Root subcommand registry.
 *
 * Adding a command:
 * 1. Create `src/commands/<name>.ts` exporting a default citty `defineCommand`
 *    (prefer `defineEvlogCommand` from `lib/command` so the branded header is automatic)
 * 2. Add one lazy entry to {@link subCommands}
 *
 * Entries are dynamic imports so a run only loads the command it executes:
 * `evlog doctor` never pulls in the parser `map` and `init` depend on.
 */
export const subCommands: SubCommandsDef = {
  init: () => load(import('./init')),
  agents: () => load(import('./agents')),
  doctor: () => load(import('./doctor')),
  map: () => load(import('./map')),
  telemetry: () => load(import('./telemetry')),
}
