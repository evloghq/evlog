import { createError, defineEventHandler } from 'h3'

export default defineEventHandler(() => {
  throw createError({ statusCode: 409, message: 'conflict in route' })
})
