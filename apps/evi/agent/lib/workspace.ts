/** The template clone with dependencies installed; sessions read, verify, and push from here. */
export const REPO_DIR = '/workspace/repo'

/** What a failed sandbox command has to say for itself: stderr first, stdout as fallback. */
export function runOutput(run: { stdout?: unknown, stderr?: unknown }): string {
  return String(run.stderr ?? '').trim() || String(run.stdout ?? '').trim()
}
