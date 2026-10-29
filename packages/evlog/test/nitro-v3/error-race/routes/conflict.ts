import { defineHandler } from 'nitro/h3'
import { createError } from 'evlog'

export default defineHandler(() => {
  throw createError({ message: 'Conflict', status: 409 })
})
