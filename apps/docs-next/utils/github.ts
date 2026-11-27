export interface LastContentCommitOptions {
  /** `owner/name` of the content repository. */
  repo: string
  /** Content directory; leading and trailing slashes are trimmed. */
  path: string
  /** Branch or commit to walk history from. */
  ref: string
  token?: string
}

/**
 * The last commit reachable from `ref` that touched `path`.
 */
export async function fetchLastContentCommit(opts: LastContentCommitOptions): Promise<string | undefined> {
  const query = new URLSearchParams({
    sha: opts.ref,
    path: opts.path.replace(/^\/+|\/+$/g, ''),
    per_page: '1',
  })

  const response = await fetch(`https://api.github.com/repos/${opts.repo}/commits?${query}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  })

  if (!response.ok) {
    throw Object.assign(new Error(`GitHub commits query failed with ${response.status}`), {
      statusCode: response.status,
    })
  }

  const commits = (await response.json()) as Array<{ sha?: string }>
  return commits[0]?.sha
}
