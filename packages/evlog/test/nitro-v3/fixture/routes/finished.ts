import { defineHandler } from 'nitro/h3'
import { finished } from '../evlog-plugin'

export default defineHandler(() => finished)
