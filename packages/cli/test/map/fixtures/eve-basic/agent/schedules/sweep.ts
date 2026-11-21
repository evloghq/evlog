import { defineSchedule } from 'eve/schedules'

export default defineSchedule({
  cron: '*/30 * * * *',
  content: 'Close sessions idle for a day.',
})
