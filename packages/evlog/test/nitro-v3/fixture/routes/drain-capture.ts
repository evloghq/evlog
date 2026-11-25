import { defineHandler } from 'nitro/h3'
import { captures } from '../drain-capture'

export default defineHandler(event => captures.get(event.url.searchParams.get('id') ?? '') ?? null)
