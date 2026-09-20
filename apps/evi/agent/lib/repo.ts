/** A GitHub repository, as the API and the channel state address it. */
export interface Repository {
  readonly owner: string
  readonly repo: string
}

const SLUG_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/

const DEFAULT_HOME = 'evloghq/evlog'

/** Parses an `owner/repo` slug; null when it is not one. */
export function parseRepository(slug: string): Repository | null {
  const match = SLUG_PATTERN.exec(slug)
  if (match === null || slug.includes('..')) return null
  return { owner: match[1]!, repo: match[2]! }
}

/**
 * The repository this deployment is for: `EVI_REPOSITORY` as an `owner/repo`
 * slug, the evlog repository when unset. It is the sandbox template clone,
 * the default for the GitHub tools, and where `git__push` lands unless told
 * otherwise. A GitHub thread on another repository still escalates there,
 * through `repositoryOf`.
 */
export function homeRepository(): Repository {
  const slug = process.env.EVI_REPOSITORY ?? DEFAULT_HOME
  const repository = parseRepository(slug)
  if (repository === null) throw new Error(`EVI_REPOSITORY must be an owner/repo slug, got "${slug}".`)
  return repository
}

/** The repository a GitHub conversation belongs to, read from the channel state the webhook seeded. */
export function repositoryOf(state: Repository): Repository {
  return { owner: state.owner, repo: state.repo }
}

/** Whether a webhook's repository is the home one; GitHub names are case-insensitive. */
export function isHomeRepository(repository: { readonly owner: string, readonly name: string }): boolean {
  const home = homeRepository()
  return repository.owner.toLowerCase() === home.owner.toLowerCase()
    && repository.name.toLowerCase() === home.repo.toLowerCase()
}

export function repositorySlug(repository: Repository): string {
  return `${repository.owner}/${repository.repo}`
}

export function cloneUrl(repository: Repository): string {
  return `https://github.com/${repositorySlug(repository)}.git`
}
