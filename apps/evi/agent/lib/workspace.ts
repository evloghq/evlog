import { isHomeRepository, type Repository, repositorySlug } from './repo'

/** The template clone with dependencies installed; sessions read, verify, and push from here. */
export const REPO_DIR = '/workspace/repo'

/** Where a repository lives in the sandbox: the template clone for the home one, its own directory otherwise. */
export function checkoutDir(repository: Repository): string {
  if (isHomeRepository({ owner: repository.owner, name: repository.repo })) return REPO_DIR
  return `/workspace/${repositorySlug(repository)}`
}

/** What a failed sandbox command has to say for itself: stderr first, stdout as fallback. */
export function runOutput(run: { stdout?: unknown, stderr?: unknown }): string {
  return String(run.stderr ?? '').trim() || String(run.stdout ?? '').trim()
}
