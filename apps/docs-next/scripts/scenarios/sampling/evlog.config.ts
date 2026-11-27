import { defineEvlog } from 'evlog'
import { capture } from '../../drain.ts'

export default defineEvlog({
  service: 'my-app',
  sampling: {
    rates: { info: 10, warn: 50, debug: 0 },
    keep: [
      { status: 400 },
      { duration: 1000 },
      { path: '/api/payments/**' },
    ],
  },
  drain: capture,
})
