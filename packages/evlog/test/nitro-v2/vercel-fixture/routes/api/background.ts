import { defineEventHandler } from 'h3'
import { useLogger } from '../../../../../src/runtime/server/useLogger'
import { fixtureState } from '../../plugins/store'

export default defineEventHandler((event) => {
  void useLogger(event).audit({
    action: 'variables.read',
    actor: { type: 'user', id: 'usr_alice', email: 'alice@acme.com' },
    target: { type: 'environment', id: 'env_1' },
    tenantId: 'team_7',
  })
  return { stored: fixtureState().audits.map(record => record.action) }
})
