import type { AuditableLogger } from '../../src/audit'
import type { AuditActor } from '../../src/types'

// No Vitest import: the built-app fixtures import this file into their server bundle.

/** Route that runs {@link recordMatrixAudits}. */
export const AUDIT_PATH = '/api/audit'

/** The same route, which an audit check filters out with `exclude`. */
export const EXCLUDED_AUDIT_PATH = '/api/audit-excluded'

export const MATRIX_TOKEN: AuditActor = { type: 'api', id: 'tok_12', onBehalfOf: { type: 'user', id: 'usr_alice' } }

/** What {@link AUDIT_PATH} does: two awaited audits for two tenants, the second a denial. */
export async function recordMatrixAudits(log: Pick<AuditableLogger, 'audit'>): Promise<void> {
  await log.audit({ action: 'token.create', actor: MATRIX_TOKEN, target: { type: 'token', id: 'tok_99' }, tenantId: 'team_1' })
  await log.audit.deny('Missing team:admin', { action: 'team.delete', actor: MATRIX_TOKEN, target: { type: 'team', id: 'team_2' }, tenantId: 'team_2' })
}
