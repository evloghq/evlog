import { createError, EvlogError } from 'evlog'
import { describe, expect, it } from 'vitest'
import { eviErrors, refusal } from './errors'

describe('eviErrors', () => {
  it('prefixes every code with the catalog name', () => {
    expect(eviErrors._prefix).toBe('evi')
    expect(eviErrors._codes.every(code => code.startsWith('evi.'))).toBe(true)
    expect(eviErrors.GITHUB_REQUEST_FAILED.code).toBe('evi.GITHUB_REQUEST_FAILED')
  })

  it('keeps third-party bodies out of the serialized error', () => {
    const error = eviErrors.GITHUB_REQUEST_FAILED({ request: 'label lookup', responseStatus: 403, internal: { body: 'secret body' } })
    expect(error.message).toBe('GitHub label lookup failed (403)')
    expect(error.status).toBe(502)
    expect(error.internal).toEqual({ body: 'secret body' })
    expect(JSON.stringify(error)).not.toContain('secret body')
  })

  it('templates typed params and accepts a message override', () => {
    expect(eviErrors.GIT_COMMAND_FAILED({ command: 'push', exitCode: 128 }).message).toBe('git push exited 128')
    expect(eviErrors.CAPTURE_ORIGIN_REFUSED({ message: 'nope' }).message).toBe('nope')
  })

  it('tells the model to keep the work when Amp cannot run', () => {
    expect(refusal(eviErrors.AMP_API_KEY_MISSING())).toEqual({
      success: false,
      code: 'evi.AMP_API_KEY_MISSING',
      error: 'AMP_API_KEY is not configured. Set AMP_API_KEY on the evi Vercel project (Production and Preview) to an Amp access token that starts with sgamp_. Then do the work yourself for this turn.',
    })
    expect(eviErrors.AMP_API_KEY_INVALID().code).toBe('evi.AMP_API_KEY_INVALID')
    expect(eviErrors.AMP_CLI_MISSING().code).toBe('evi.AMP_CLI_MISSING')
    expect(eviErrors.AMP_EXECUTE_FAILED().code).toBe('evi.AMP_EXECUTE_FAILED')
  })
})

describe('refusal', () => {
  it('returns the code and the message the model reads, with the fix appended', () => {
    expect(refusal(eviErrors.BLOB_TOKEN_MISSING())).toEqual({
      success: false,
      code: 'evi.BLOB_TOKEN_MISSING',
      error: 'BLOB_READ_WRITE_TOKEN is not configured. Locally, run `vercel env pull` in apps/evi.',
    })
    expect(refusal(eviErrors.INPUT_REFUSED({ message: 'bad ref' }))).toEqual({
      success: false,
      code: 'evi.INPUT_REFUSED',
      error: 'bad ref',
    })
  })

  it('refuses an error without a code', () => {
    const error: EvlogError = createError('bare')
    expect(() => refusal(error)).toThrow(TypeError)
  })
})
