import evlog from '@evlog/eve'
import { createFsDrain } from 'evlog/fs'

const dir = process.env.EVLOG_FIXTURE_LOGS ?? '.evlog/logs'

export default evlog({
  service: 'refund-agent',
  drain: createFsDrain({ dir }),
  logs: { dir, diagnostics: true },
})
