import type { IncomingMessage } from 'node:http'
import { describe, expectTypeOf, it } from 'vitest'
import type { Effect } from 'effect'
import { Elysia } from 'elysia'
import type { Request as ExpressRequest } from 'express'
import type { FastifyRequest } from 'fastify'
import { Hono } from 'hono'
import type { HTTPEvent } from 'nitro/h3'
import type { RouterContext } from 'react-router'
import type pkg from '../../package.json'
import type { AuditableLogger, ForkableLogger, ServerEvent } from '../../src'
import type { BaseEvlogOptions } from '../../src/shared/middleware'
import type { NitroModuleOptions, NitroRequestLogger } from '../../src/nitro'
import { evlog as effectEvlog, EvlogLogger, routerLayer, useLogger as effectUseLogger } from '../../src/effect/index'
import { evlog as elysiaEvlog, useLogger as elysiaUseLogger } from '../../src/elysia/index'
import { evlog as expressEvlog, useLogger as expressUseLogger } from '../../src/express/index'
import { evlog as fastifyEvlog, useLogger as fastifyUseLogger } from '../../src/fastify/index'
import { evlog as honoEvlog, useLogger as honoUseLogger, type EvlogVariables } from '../../src/hono/index'
import { EvlogModule, useLogger as nestUseLogger } from '../../src/nestjs/index'
import { createEvlog, useLogger as nextUseLogger } from '../../src/next/index'
import nitroV2Module, { useLogger as nitroV2UseLogger } from '../../src/nitro/module'
import nitroV3Module, { useLogger as nitroV3UseLogger } from '../../src/nitro-v3/index'
import type { ModuleOptions as NuxtModuleOptions } from '../../src/nuxt/module'
import { useLogger as nuxtUseLogger } from '../../src/runtime/server/useLogger'
import { evlog as orpcEvlog, useLogger as orpcUseLogger, withEvlog as orpcWithEvlog, type EvlogOrpcContext } from '../../src/orpc/index'
import { evlog as reactRouterEvlog, loggerContext, useLogger as reactRouterUseLogger } from '../../src/react-router/index'
import { createEvlogHooks, evlog as sveltekitEvlog, useLogger as sveltekitUseLogger } from '../../src/sveltekit/index'
import type * as workers from '../../src/workers/index'
import { withEvlog as workersWithEvlog, type WorkersRequestLogger } from '../../src/workers/index'

/*
 * The integration contract (AGENTS.md, create-framework-integration skill):
 * `evlog()` accepting every `BaseEvlogOptions` field, a zero-argument
 * AsyncLocalStorage `useLogger()`, and `log.fork()` on the native accessor.
 * Each `describe` is one row of the table in
 * `.agents/skills/create-framework-integration/references/contract.md`.
 * An exception asserts the shape the integration has instead, so closing a gap
 * means updating its row here and in that table.
 */

type BaseOptionKey = keyof BaseEvlogOptions

/** The `BaseEvlogOptions` fields `T` declares; equal to `BaseEvlogOptions` only when it drops none. */
type BaseSlice<T> = Pick<T, BaseOptionKey & keyof T>

type OptionsOf<T extends (...args: any[]) => unknown, TIndex extends number = 0> = NonNullable<Parameters<T>[TIndex]>

/** `BaseEvlogOptions` fields a Nitro-based integration takes as `evlog:*` hooks or from `evlog.config.ts`. */
type NitroHookOptionKey = 'drain' | 'enrich' | 'keep' | 'plugins' | 'waitUntil'

type ZeroArgUseLogger = <T extends object = Record<string, unknown>>() => AuditableLogger<T>

type FrameworkIntegration =
  | './effect'
  | './elysia'
  | './express'
  | './fastify'
  | './hono'
  | './nestjs'
  | './next'
  | './nitro'
  | './nitro/v2'
  | './nuxt'
  | './orpc'
  | './react-router'
  | './sveltekit'
  | './workers'

type NotAFrameworkIntegration =
  | '.'
  | './package.json'
  | './ai'
  | './axiom'
  | './better-auth'
  | './better-stack'
  | './catalog'
  | './clickhouse'
  | './client'
  | './datadog'
  | './diagnostics'
  | './enrichers'
  | './fs'
  | './http'
  | './hyperdx'
  | './loki'
  | './memory'
  | './next/client'
  | './next/instrumentation'
  | './next/instrumentation/create'
  | './next/stream'
  | './otel'
  | './otlp'
  | './otlp/protobuf'
  | './pipeline'
  | './posthog'
  | './sazabi'
  | './sentry'
  | './stream'
  | './toolkit'
  | './toolkit/storage'
  | './vite'
  | './webhook'

describe('integration contract', () => {
  it('classifies every package export, so a new integration gets a row', () => {
    expectTypeOf<keyof typeof pkg.exports>().toEqualTypeOf<FrameworkIntegration | NotAFrameworkIntegration>()
  })
})

describe('evlog/hono', () => {
  it('meets the contract', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof honoEvlog>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(honoUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    new Hono<EvlogVariables>().get('/', (c) => {
      expectTypeOf(c.get('log')).toEqualTypeOf<ForkableLogger>()
      return c.text('ok')
    })
  })
})

describe('evlog/express', () => {
  it('meets the contract', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof expressEvlog>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(expressUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    expectTypeOf<ExpressRequest['log']>().toEqualTypeOf<ForkableLogger | undefined>()
  })
})

describe('evlog/fastify', () => {
  it('meets the contract', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof fastifyEvlog, 1>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(fastifyUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    expectTypeOf<FastifyRequest['evlog']>().toEqualTypeOf<ForkableLogger>()
  })
})

describe('evlog/elysia', () => {
  it('meets the contract', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof elysiaEvlog>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(elysiaUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    new Elysia().use(elysiaEvlog()).get('/', ({ log }) => {
      expectTypeOf(log).toEqualTypeOf<ForkableLogger>()
      return 'ok'
    })
  })
})

describe('evlog/nestjs', () => {
  it('meets the contract', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof EvlogModule.forRoot>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(nestUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    expectTypeOf<IncomingMessage['log']>().toEqualTypeOf<ForkableLogger | undefined>()
  })
})

describe('evlog/orpc', () => {
  it('meets the contract, with `withEvlog()` taking the options and `evlog()` as procedure middleware', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof orpcWithEvlog, 1>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(orpcEvlog).parameters.toEqualTypeOf<[]>()
    expectTypeOf(orpcUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    expectTypeOf<EvlogOrpcContext['log']>().toEqualTypeOf<ForkableLogger>()
  })
})

describe('evlog/react-router', () => {
  it('meets the contract', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof reactRouterEvlog>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(reactRouterUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    expectTypeOf(loggerContext).toEqualTypeOf<RouterContext<ForkableLogger>>()
  })
})

describe('evlog/sveltekit', () => {
  it('meets the contract', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof sveltekitEvlog>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf<BaseSlice<OptionsOf<typeof createEvlogHooks>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(sveltekitUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
  })

  it('leaves `event.locals.log` untyped: the app declares it on `App.Locals`', () => {
    expectTypeOf<Parameters<ReturnType<typeof sveltekitEvlog>>[0]['event']['locals']>().toEqualTypeOf<Record<string, any>>()
  })
})

describe('evlog/next', () => {
  it('meets the contract through `createEvlog()`, with `useLogger()` as the only accessor', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof createEvlog>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(nextUseLogger).toEqualTypeOf<ZeroArgUseLogger>()
    expectTypeOf(createEvlog).returns.toHaveProperty('useLogger').toEqualTypeOf<ZeroArgUseLogger>()
  })
})

describe('evlog/workers (exception: no AsyncLocalStorage)', () => {
  it('takes the full options and passes the logger as the handler\'s fourth argument', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof workersWithEvlog, 1>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf<typeof workers>().not.toHaveProperty('useLogger')
    expectTypeOf<Parameters<OptionsOf<typeof workersWithEvlog>>[3]>().toEqualTypeOf<WorkersRequestLogger>()
  })

  it('has `log.fork()`, handing the child to `fn` and still accepting a zero-argument `fn`', () => {
    expectTypeOf<WorkersRequestLogger>().toExtend<ForkableLogger>()
    expectTypeOf<Parameters<WorkersRequestLogger['fork']>[1]>().parameters.toEqualTypeOf<[log: AuditableLogger]>()
  })
})

describe('evlog/effect (exception: the logger is an Effect service)', () => {
  it('takes the full options and returns the logger from `useLogger()` as an Effect', () => {
    expectTypeOf<BaseSlice<OptionsOf<typeof effectEvlog>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf<BaseSlice<OptionsOf<typeof routerLayer>>>().toEqualTypeOf<BaseEvlogOptions>()
    expectTypeOf(effectUseLogger()).toEqualTypeOf<Effect.Effect<AuditableLogger, never, EvlogLogger>>()
    expectTypeOf<EvlogLogger['Service']>().toEqualTypeOf<AuditableLogger>()
  })
})

describe('evlog/nitro, evlog/nitro/v2, evlog/nuxt', () => {
  it('take route options from the module and the callbacks as `evlog:*` hooks', () => {
    expectTypeOf<Exclude<BaseOptionKey, keyof NitroModuleOptions>>().toEqualTypeOf<NitroHookOptionKey>()
    expectTypeOf<Pick<NitroModuleOptions, Exclude<BaseOptionKey, NitroHookOptionKey>>>()
      .toEqualTypeOf<Omit<BaseEvlogOptions, NitroHookOptionKey>>()
    expectTypeOf<OptionsOf<typeof nitroV3Module>>().toEqualTypeOf<NitroModuleOptions>()
    expectTypeOf<OptionsOf<typeof nitroV2Module>>().toEqualTypeOf<NitroModuleOptions>()
    expectTypeOf<Pick<NuxtModuleOptions, Exclude<BaseOptionKey, NitroHookOptionKey>>>()
      .toEqualTypeOf<Omit<BaseEvlogOptions, NitroHookOptionKey>>()
    expectTypeOf<Exclude<BaseOptionKey, keyof NuxtModuleOptions>>().toEqualTypeOf<NitroHookOptionKey>()
  })

  it('take the event optionally in `useLogger()`, which returns a logger with `log.fork()`', () => {
    expectTypeOf(nitroV3UseLogger).parameters.toEqualTypeOf<[event?: HTTPEvent, service?: string]>()
    expectTypeOf(nitroV3UseLogger).returns.toEqualTypeOf<NitroRequestLogger>()
    expectTypeOf(nitroV2UseLogger).parameters.toEqualTypeOf<[event?: ServerEvent, service?: string]>()
    expectTypeOf(nitroV2UseLogger).returns.toEqualTypeOf<NitroRequestLogger>()
    expectTypeOf(nuxtUseLogger).toEqualTypeOf(nitroV2UseLogger)
    expectTypeOf<ReturnType<typeof nitroV3UseLogger>>().toExtend<ForkableLogger>()
    expectTypeOf<Parameters<NitroRequestLogger['fork']>[1]>().parameters.toEqualTypeOf<[log: AuditableLogger]>()
  })
})
