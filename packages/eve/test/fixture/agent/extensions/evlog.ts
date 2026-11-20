import evlog from '@evlog/eve'
import { createFsDrain } from 'evlog/fs'

const dir = process.env.EVLOG_FIXTURE_LOGS ?? '.evlog/logs'

// EVLOG_FIXTURE_CONNECT_STATUS stands in for Vercel Connect's answer, so a Vercel read fails without the network.
const connectStatus = Number(process.env.EVLOG_FIXTURE_CONNECT_STATUS)
if (connectStatus) {
  const original = globalThis.fetch
  globalThis.fetch = (input, init) => new URL(String(input)).hostname.endsWith('.vercel.com')
    ? Promise.resolve(new Response('{"error":{"code":"forbidden"}}', { status: connectStatus }))
    : original(input, init)
}

export default evlog({
  service: 'refund-agent',
  drain: createFsDrain({ dir }),
  logs: { dir, diagnostics: true, source: process.env.EVLOG_FIXTURE_SOURCE === 'vercel' ? 'vercel' : 'files' },
})
