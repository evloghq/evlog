import { defineEvlog } from 'evlog'
import { capture } from '../../drain.ts'

export default defineEvlog({
  service: 'my-app',
  redact: {
    paths: ['password', '*_token', 'headers.x-forwarded-for'],
    builtins: ['email', 'creditCard'],
    patterns: [/sk_live_\w+/g],
  },
  drain: capture,
})
