import type { IncomingMessage } from 'node:http'
import { describe, expectTypeOf, it } from 'vitest'
import { Elysia } from 'elysia'
import type { Request } from 'express'
import type { RouterContext } from 'react-router'
import type { AuditableLogger, ForkableLogger } from '../../src'
import { evlog as elysiaEvlog } from '../../src/elysia/index'
import '../../src/express/index'
import { useLogger } from '../../src/hono/index'
import '../../src/nestjs/index'
import { loggerContext } from '../../src/react-router/index'

type Fork = (label: string, fn: () => void | Promise<void>) => Promise<void>

describe('request logger fork typing', () => {
  it('types fork as required on ForkableLogger', () => {
    expectTypeOf<ForkableLogger['fork']>().toEqualTypeOf<Fork>()
  })

  it('types the framework-native accessors as ForkableLogger', () => {
    expectTypeOf<Request['log']>().toEqualTypeOf<ForkableLogger | undefined>()
    expectTypeOf<IncomingMessage['log']>().toEqualTypeOf<ForkableLogger | undefined>()
    expectTypeOf(loggerContext).toEqualTypeOf<RouterContext<ForkableLogger>>()

    new Elysia().use(elysiaEvlog()).get('/', ({ log }) => {
      expectTypeOf(log).toEqualTypeOf<ForkableLogger>()
      return 'ok'
    })
  })

  it('keeps fork optional on useLogger(), which returns the forked logger inside log.fork()', () => {
    expectTypeOf(useLogger).returns.toEqualTypeOf<AuditableLogger>()
    expectTypeOf<AuditableLogger['fork']>().toEqualTypeOf<Fork | undefined>()
  })
})
