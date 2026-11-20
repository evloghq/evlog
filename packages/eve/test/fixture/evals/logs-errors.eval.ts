import { defineEval } from 'eve/evals'

// The declined refund's turn is drained before the next turn starts, so the
// logs tool reads it back in the same session. A local-dev caller is not a
// private audience, so the tool reads this session only: the other evals'
// declined refund stays out.
export default defineEval({
  async test(t) {
    const declined = await t.send('refund bad')
    await declined.session.send('logs errors where customer.email!=ops@clearbill.dev')
    t.calledTool('evlog__logs', {
      count: 1,
      output: (value) => {
        const result = value as { scope: string, matched: number, origin: { kind: string }, caller?: { session: string }, coverage: { complete: boolean }, rows: Array<{ result?: string, error?: { code?: string, why?: string }, failedTools?: string[] }> }
        const [row] = result.rows
        return result.scope === 'session' && result.matched === 1
          && result.origin.kind === 'files' && result.caller?.session === declined.session.id && result.coverage.complete
          && row?.result === 'recovered'
          && row?.error?.code === 'REFUND_DECLINED' && row.error.why === 'The card issuer rejected the reversal'
          && row.failedTools?.[0] === 'issue_refund'
      },
    })
    t.succeeded()
  },
})
