import evlog from '@evlog/eve'
import { createFsDrain } from 'evlog/fs'

export default evlog({
  service: 'refund-agent',
  drain: createFsDrain({ dir: process.env.EVLOG_FIXTURE_LOGS ?? '.evlog/logs' }),
})
