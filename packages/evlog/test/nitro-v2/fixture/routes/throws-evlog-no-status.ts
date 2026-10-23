import { defineEventHandler } from 'h3'
import { createError } from 'evlog'

export default defineEventHandler(() => {
  throw createError({ message: 'Turn could not start' })
})
