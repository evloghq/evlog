import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { requestConnectToken, VercelReadError, vercelScope } from '../../../../evlog/src/logs-vercel'
import type { VercelScope } from '../../../../evlog/src/logs-vercel'
import { cliErrors } from '../errors'

export { DEFAULT_VERCEL_CONNECTOR, readVercelLogs, VercelReadError } from '../../../../evlog/src/logs-vercel'
export type { VercelLogsSummary, VercelScope } from '../../../../evlog/src/logs-vercel'

/** A project `vercel link` linked: where its `.vercel` directory is, and its ids. */
export interface VercelProject {
  dir: string
  projectId: string
  teamId: string
}

/** The nearest `.vercel/project.json` from `start` up to `root`. */
export async function findVercelProject(start: string, root: string): Promise<VercelProject | undefined> {
  let dir = start
  for (;;) {
    const file = join(dir, '.vercel', 'project.json')
    if (existsSync(file)) {
      const linked = JSON.parse(await readFile(file, 'utf8')) as { projectId?: unknown, orgId?: unknown }
      if (typeof linked.projectId === 'string' && typeof linked.orgId === 'string') return { dir, projectId: linked.projectId, teamId: linked.orgId }
      return undefined
    }
    if (dir === root || dirname(dir) === dir) return undefined
    dir = dirname(dir)
  }
}

export interface VercelAccess {
  /** A Vercel API token from the connector. */
  token: string
  scope: VercelScope
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n').filter(Boolean).at(-1) ?? 'unknown error'

/**
 * The linked project's OIDC token, refreshed with the developer's `vercel
 * login`, exchanged for a token from `connector`. The scope comes from the OIDC
 * token, so the read is pinned to the project that asked.
 */
export async function resolveVercelAccess(project: VercelProject, connector: string): Promise<VercelAccess> {
  const { getVercelOidcToken } = await import('@vercel/oidc')
  let oidc: string
  try {
    oidc = await getVercelOidcToken({ team: project.teamId, project: project.projectId })
  } catch (error) {
    throw cliErrors.LOGS_VERCEL_NO_TOKEN({ reason: reasonOf(error) })
  }
  const scope = vercelScope(oidc)
  if (!scope || scope.projectId !== project.projectId) {
    throw cliErrors.LOGS_VERCEL_NO_TOKEN({ reason: `the OIDC token was not issued to the linked project ${project.projectId}` })
  }
  try {
    return { token: await requestConnectToken(oidc, connector), scope }
  } catch (error) {
    if (error instanceof VercelReadError) throw cliErrors.LOGS_VERCEL_NOT_SET_UP({ connector, reason: `Vercel Connect answered ${error.status}${error.message ? `: ${error.message}` : ''}` })
    throw error
  }
}
