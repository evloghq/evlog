import { drained } from '../plugins/drained'

export default defineEventHandler(() => drained.splice(0))
