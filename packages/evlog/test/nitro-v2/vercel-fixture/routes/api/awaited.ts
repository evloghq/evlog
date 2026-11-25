import { defineEventHandler } from 'h3'
import { useLogger } from '../../../../../src/runtime/server/useLogger'
import { fixtureState } from '../../plugins/store'

export default defineEventHandler(async (event) => {
  await useLogger(event).audit({
    action: 'token.create',
    actor: { type: 'api', id: 'tok_12', onBehalfOf: { type: 'user', id: 'usr_alice', email: 'alice@acme.com' } },
    target: { type: 'token', id: 'tok_99' },
    tenantId: 'team_7',
  })
  return { stored: fixtureState().audits.map(record => record.action) }
})
