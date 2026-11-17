import { defineHandler } from 'nitro/h3'
import { drained } from '../plugins/drained'

export default defineHandler(() => drained.splice(0))
