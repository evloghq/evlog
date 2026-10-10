import { lazyCommand } from '../lib/command'

/**
 * Root subcommand registry.
 *
 * Adding a command:
 * 1. Create `src/commands/<name>.ts` exporting a default citty `defineCommand`
 *    (prefer `defineEvlogCommand` from `lib/command` so the branded header is automatic)
 * 2. Add one {@link lazyCommand} entry here, with the description `--help` shows
 *
 * A run loads only the command it executes, and `--help` loads none of them:
 * `evlog doctor` never pulls in the parser `map` and `init` depend on.
 */
export const subCommands = {
  init: lazyCommand(
    { name: 'init', description: 'Wire evlog into this project — install, config, drains' },
    () => import('./init'),
  ),
  agents: lazyCommand(
    { name: 'agents', description: 'Write evlog conventions into AGENTS.md and install the agent skills' },
    () => import('./agents'),
  ),
  doctor: lazyCommand(
    { name: 'doctor', description: 'Diagnose your evlog setup' },
    () => import('./doctor'),
  ),
  config: lazyCommand(
    { name: 'config', description: 'Show the evlog.config that applies here and where each setting comes from' },
    () => import('./config'),
  ),
  logs: lazyCommand(
    { name: 'logs', description: 'Read the wide events your app wrote to .evlog/logs' },
    () => import('./logs'),
  ),
  map: lazyCommand(
    { name: 'map', description: 'Static observability map — Lighthouse for wide events' },
    () => import('./map'),
  ),
  telemetry: lazyCommand(
    { name: 'telemetry', description: 'View or change anonymous usage telemetry settings' },
    () => import('./telemetry'),
    { group: true },
  ),
}
