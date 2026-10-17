import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cause, Data, Effect } from 'effect'
import { createError } from '../../src/error'
import { createLogger, initLogger } from '../../src/logger'
import { recordCause } from '../../src/effect/cause'
import { withLogger } from '../../src/effect/index'
import { createPipelineSpies, waitForDrainCalls } from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'

class ModelRefused extends Data.TaggedError('ModelRefused')<{ prompt: string }> {}

async function failedEvent(cause: Cause.Cause<unknown>) {
  const { drain } = createPipelineSpies()
  await Effect.runPromiseExit(Effect.failCause(cause).pipe(withLogger('turn', { drain })))
  await waitForDrainCalls(drain)
  return getDrainCallArg(defined(drain.mock.calls[0], 'drain call')).event
}

describe('evlog/effect recordCause', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records a tagged error by its tag without its fields', async () => {
    const event = await failedEvent(Cause.fail(new ModelRefused({ prompt: 'summarize my inbox' })))

    expect(event.level).toBe('error')
    expect(event.error).toMatchObject({ name: 'ModelRefused' })
    expect(JSON.stringify(event)).not.toContain('summarize my inbox')
  })

  it('keeps the fields of an evlog error', async () => {
    const event = await failedEvent(Cause.fail(createError({ message: 'Payment declined', status: 402, why: 'Card expired' })))

    expect(event.error).toMatchObject({ message: 'Payment declined', why: 'Card expired' })
  })

  it('records a plain tagged object by its tag only', async () => {
    const event = await failedEvent(Cause.fail({ _tag: 'ToolFailed', input: { query: 'secret' } }))

    expect(event.error).toMatchObject({ name: 'ToolFailed', message: 'ToolFailed' })
    expect(JSON.stringify(event)).not.toContain('secret')
  })

  it.each([
    ['a number', 4242],
    ['a plain object', { token: 'sk_live_4242' }],
  ])('records %s as an UnknownError without its value', async (_, value) => {
    const event = await failedEvent(Cause.fail(value))

    expect(event.error).toMatchObject({ name: 'UnknownError' })
    expect(JSON.stringify(event)).not.toContain('4242')
  })

  it('uses a string failure as the message', async () => {
    const event = await failedEvent(Cause.fail('quota exceeded'))

    expect(event.error).toMatchObject({ message: 'quota exceeded' })
  })

  it('records the failure before a defect and suppresses the defect', async () => {
    const event = await failedEvent(Cause.fromReasons([
      Cause.makeDieReason(new TypeError('cannot read properties of undefined')),
      Cause.makeFailReason(new Error('Payment declined')),
    ]))

    expect(event.error).toMatchObject({
      message: 'Payment declined',
      suppressed: [{ name: 'TypeError', message: 'cannot read properties of undefined' }],
    })
  })

  it('records a defect as the error', async () => {
    const event = await failedEvent(Cause.die(new Error('database unavailable')))

    expect(event.level).toBe('error')
    expect(event.error).toMatchObject({ message: 'database unavailable' })
  })

  it('records an interruption as cancelled, without an error', async () => {
    const event = await failedEvent(Cause.interrupt())

    expect(event.status).toBe(499)
    expect(event.error).toBeUndefined()
    expect(event.level).toBe('info')
  })

  it('keeps the status already set on an interrupted unit', () => {
    const logger = createLogger({ status: 200 })
    recordCause(logger, Cause.interrupt())

    expect(logger.getContext().status).toBe(200)
  })

  it('records nothing when every defect is skipped', () => {
    const logger = createLogger()
    recordCause(logger, Cause.die(new Error('response')), { skipDefect: () => true })

    expect(logger.getContext().error).toBeUndefined()
    expect(logger.getContext().status).toBeUndefined()
  })
})
