import { GITHUB_API, OWNER, REPO } from './repo'

export interface IssueSnapshot {
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
}

export interface RepositoryLabel {
  readonly name: string
  readonly description: string | null
}

/** The issue fields the triage router reasons over. */
export async function fetchIssueSnapshot(issueNumber: number, token: string): Promise<IssueSnapshot> {
  const issue = await githubGet<{ title?: unknown, body?: unknown, labels?: unknown }>(token, `/repos/${OWNER}/${REPO}/issues/${issueNumber}`)
  return {
    title: typeof issue.title === 'string' ? issue.title : '',
    body: typeof issue.body === 'string' ? issue.body : '',
    labels: labelNames(issue.labels),
  }
}

export async function listRepositoryLabels(token: string): Promise<readonly RepositoryLabel[]> {
  const labels = await githubGet<unknown>(token, `/repos/${OWNER}/${REPO}/labels?per_page=100`)
  if (!Array.isArray(labels)) return []
  return labels
    .filter((label): label is { name?: unknown, description?: unknown } => typeof label === 'object' && label !== null)
    .map(label => ({
      name: typeof label.name === 'string' ? label.name : '',
      description: typeof label.description === 'string' ? label.description : null,
    }))
    .filter((label): label is RepositoryLabel => label.name !== '')
}

export async function addIssueLabels(issueNumber: number, labels: readonly string[], token: string): Promise<void> {
  await githubRequest(token, 'POST', `/repos/${OWNER}/${REPO}/issues/${issueNumber}/labels`, { labels: [...labels] })
}

function labelNames(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((label) => {
      if (typeof label === 'string') return label
      if (typeof label === 'object' && label !== null && typeof (label as { name?: unknown }).name === 'string') {
        return (label as { name: string }).name
      }
      return ''
    })
    .filter(Boolean)
}

async function githubGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: headers(token) })
  if (!response.ok) {
    throw new Error(`GitHub GET ${path} failed (${response.status}): ${await response.text()}`)
  }
  return await response.json() as T
}

async function githubRequest(token: string, method: string, path: string, body: unknown): Promise<void> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: headers(token),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${await response.text()}`)
  }
}

function headers(token: string): Record<string, string> {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}