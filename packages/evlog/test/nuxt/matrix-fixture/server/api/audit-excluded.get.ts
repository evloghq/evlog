import { recordMatrixAudits } from '../../../../helpers/matrixAudits'

export default defineEventHandler(async () => {
  await recordMatrixAudits(useLogger())
  return { ok: true }
})
