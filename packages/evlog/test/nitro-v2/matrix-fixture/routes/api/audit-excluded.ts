import { defineEventHandler } from 'h3'
import { useLogger } from '../../../../../src/runtime/server/useLogger'
import { recordMatrixAudits } from '../../../../helpers/matrixAudits'

export default defineEventHandler(async () => {
  await recordMatrixAudits(useLogger())
  return { ok: true }
})
