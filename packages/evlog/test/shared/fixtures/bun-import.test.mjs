import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { evlog, useLogger } from '../../../src/elysia/index.ts'
import { initLogger } from '../../../src/logger.ts'
import '../../../src/eve/index.ts'

initLogger({ silent: true })

let beforeCalls = 0
let afterCalls = 0

beforeEach(async () => {
  await Promise.resolve()
  beforeCalls++
})

afterEach(async () => {
  await Promise.resolve()
  afterCalls++
})

afterAll(() => {
  expect(beforeCalls).toBe(2)
  expect(afterCalls).toBe(2)
})

test('completes the first test after importing integrations', async () => {
  const app = new Elysia()
    .use(evlog())
    .get('/context', async ({ log }) => {
      expect(useLogger()).toBe(log)
      await Promise.resolve()
      expect(useLogger()).toBe(log)
      return 'ok'
    })

  const response = await app.handle(new Request('http://localhost/context'))
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('ok')
  expect(beforeCalls).toBe(1)
})

test('completes the next test and its lifecycle hooks', () => {
  expect(beforeCalls).toBe(2)
  expect(afterCalls).toBe(1)
})
