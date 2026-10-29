import { defineHandler } from 'nitro/h3'
import { results } from '../delayed-error-hook'

export default defineHandler((event) => {
  const id = event.url.searchParams.get('id') ?? ''
  const result = results.get(id)
  if (result?.finished) results.delete(id)
  return { events: result?.events, finished: result?.finished }
})
