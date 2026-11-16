export const workspaceBootstrapCommand = [
  'cd repo',
  'corepack prepare --activate',
  'pnpm install --frozen-lockfile',
  'pnpm run dev:prepare',
].join(' && ')

const WARMUP_FAILED = 'turbo cache warm-up failed:'

/**
 * Runs main's checks once so the template ships a warm turbo cache. eve aborts
 * preparation when a command exits 1, and a check failing on main must not
 * fail the deploy: turbo still caches every task that passed, and sessions
 * rerun the failing one. `--continue` keeps turbo going past a failed task.
 */
export const cacheWarmupCommand = ['lint', 'typecheck', 'test']
  .map(task => `(cd repo && pnpm run ${task} --continue || echo '${WARMUP_FAILED} ${task}')`)
  .join(' && ')

/** The checks that failed during {@link cacheWarmupCommand}, read from its stdout. */
export function failedWarmupChecks(stdout: string): string[] {
  return stdout.split('\n')
    .filter(line => line.startsWith(WARMUP_FAILED))
    .map(line => line.slice(WARMUP_FAILED.length).trim())
}

export function agentBrowserInstallOptions(architecture: string) {
  const installBrowser = !['arm64', 'aarch64'].includes(architecture.trim())
  return { installBrowser, installSystemDependencies: installBrowser }
}
