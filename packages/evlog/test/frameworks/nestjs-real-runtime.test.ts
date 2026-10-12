import { Controller, Get, Req } from '@nestjs/common'
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type { FastifyRequest } from 'fastify'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'
import { EvlogModule, useLogger } from '../../src/nestjs/index'
import {
  assertHttpEventEmitted,
  createPipelineSpies,
  findEventViaDrain,
  waitForDrainCalls,
} from '../helpers/framework'
import { defined } from '../helpers/defined'

/**
 * Stress test: boot a real NestJS app with NestFactory's Express adapter,
 * register `EvlogModule.forRoot()`, fire HTTP requests through supertest, and
 * assert the drain pipeline runs end-to-end. Catches DI/middleware-pipeline
 * regressions that the mock `consumer.apply()` test cannot.
 *
 * Kept separate from `nestjs.test.ts` because booting a real Nest app is ~5x
 * slower than driving the middleware directly.
 */
@Controller()
class TestController {

  @Get('/api/users')
  users() {
    return { users: [] }
  }

  @Get('/api/me')
  me() {
    useLogger().set({ user: { id: 'u-1' } })
    return { ok: true }
  }

  @Get('/api/fail')
  fail() {
    throw new Error('boom from nestjs handler')
  }

}

async function bootApp(options: Parameters<typeof EvlogModule.forRoot>[0] = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [EvlogModule.forRoot(options)],
    controllers: [TestController],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('evlog/nestjs (real NestJS runtime)', () => {
  let app: INestApplication | undefined

  beforeEach(() => {
    initLogger({ env: { service: 'nestjs-real-test' }, pretty: false })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
    vi.restoreAllMocks()
  })

  it('runs the middleware through NestFactory and emits a wide event', async () => {
    const { drain } = createPipelineSpies()
    app = await bootApp({ drain })

    const res = await request(app.getHttpServer()).get('/api/users')
    expect(res.status).toBe(200)
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, {
      path: '/api/users',
      method: 'GET',
      status: 200,
      level: 'info',
    })
  })

  it('uses NestJS DI: useLogger() inside a controller resolves the request logger', async () => {
    const { drain } = createPipelineSpies()
    app = await bootApp({ drain })

    const res = await request(app.getHttpServer()).get('/api/me')
    expect(res.status).toBe(200)
    await waitForDrainCalls(drain)

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/me'),
      'wide event for /api/me',
    )
    expect((event.user as { id: string }).id).toBe('u-1')
  })

  it('drains the wide event with status 500 when a controller throws', async () => {
    // Realism note: NestJS's exception filter intercepts the throw before
    // evlog's middleware sees a `req.log.error()` call, so the wide event
    // carries status=500 but level stays 'info' (evlog does not auto-promote
    // level from status alone). Apps that want level='error' should call
    // `req.log.error(err)` from a NestJS exception filter.
    const { drain } = createPipelineSpies()
    app = await bootApp({ drain })

    const res = await request(app.getHttpServer()).get('/api/fail')
    expect(res.status).toBe(500)
    await waitForDrainCalls(drain)

    assertHttpEventEmitted(drain, { path: '/api/fail', status: 500 })
  })

  it('respects NestJS x-request-id pass-through', async () => {
    const { drain } = createPipelineSpies()
    app = await bootApp({ drain })

    await request(app.getHttpServer())
      .get('/api/users')
      .set('x-request-id', 'real-nest-req')
    await waitForDrainCalls(drain)

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/users'),
      'wide event for /api/users',
    )
    expect(event.requestId).toBe('real-nest-req')
  })

  it('initializes in a standalone application context without an HTTP adapter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EvlogModule.forRoot()],
    }).compile()

    await expect(moduleRef.init()).resolves.toBe(moduleRef)
    await moduleRef.close()
  })
})

@Controller()
class FastifyTestController {

  @Get('/api/web-vitals')
  webVitals(@Req() request: FastifyRequest) {
    request.log.set({ metric: 'LCP' })
    return { ok: true }
  }

}

class TagGuard implements CanActivate {

  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<FastifyRequest>().log.set({ guard: 'tag' })
    return true
  }

}

async function bootFastifyApp(
  evlogModule: ReturnType<typeof EvlogModule.forRoot>,
  setup?: (app: NestFastifyApplication) => void,
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [evlogModule],
    controllers: [FastifyTestController],
  }).compile()

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  setup?.(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return app
}

describe('evlog/nestjs (real NestJS runtime, Fastify platform)', () => {
  let app: NestFastifyApplication | undefined

  beforeEach(() => {
    initLogger({ env: { service: 'nestjs-fastify-test' }, pretty: false })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
    vi.restoreAllMocks()
  })

  it('exposes the evlog logger on FastifyRequest.log in controllers', async () => {
    const { drain } = createPipelineSpies()
    app = await bootFastifyApp(EvlogModule.forRoot({ drain }))

    const res = await app.inject({ method: 'GET', url: '/api/web-vitals' })
    expect(res.statusCode).toBe(200)
    await waitForDrainCalls(drain)

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/web-vitals'),
      'wide event for /api/web-vitals',
    )
    expect(event.metric).toBe('LCP')
    expect(event.status).toBe(200)
  })

  it('exposes the evlog logger on FastifyRequest.log to global guards', async () => {
    const { drain } = createPipelineSpies()
    app = await bootFastifyApp(EvlogModule.forRoot({ drain }), a => a.useGlobalGuards(new TagGuard()))

    await app.inject({ method: 'GET', url: '/api/web-vitals' })
    await waitForDrainCalls(drain)

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/web-vitals'),
      'wide event for /api/web-vitals',
    )
    expect(event.guard).toBe('tag')
    expect(event.metric).toBe('LCP')
  })

  it('exposes the evlog logger on FastifyRequest.log with forRootAsync()', async () => {
    const { drain } = createPipelineSpies()
    app = await bootFastifyApp(EvlogModule.forRootAsync({ useFactory: () => ({ drain }) }))

    await app.inject({ method: 'GET', url: '/api/web-vitals' })
    await waitForDrainCalls(drain)

    const event = defined(
      findEventViaDrain(drain, e => e.path === '/api/web-vitals'),
      'wide event for /api/web-vitals',
    )
    expect(event.metric).toBe('LCP')
  })
})
