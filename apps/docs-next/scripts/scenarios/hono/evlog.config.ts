import { defineEvlog } from 'evlog'
import { capture } from '../../drain.ts'

export default defineEvlog({
  service: 'my-api',
  drain: capture,
})
