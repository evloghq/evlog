import { defineEventHandler } from 'h3'
import { drained } from '../plugins/drained'

export default defineEventHandler(() => drained.splice(0))
