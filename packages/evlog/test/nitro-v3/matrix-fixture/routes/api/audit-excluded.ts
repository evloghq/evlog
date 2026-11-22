import { defineHandler } from 'nitro/h3'
import { useLogger } from '../../../../../src/nitro-v3/useLogger'
import { recordMatrixAudits } from '../../../../helpers/matrixAudits'

export default defineHandler(async () => {
  await recordMatrixAudits(useLogger())
  return { ok: true }
})
