import { describe, expectTypeOf, it } from 'vitest'
import type { WorkerExecutionContext } from '../../src/workers'
import { defineWorkerFetch, withEvlog } from '../../src/workers'

// Cloudflare's ExecutionContext beyond waitUntil, without depending on @cloudflare/workers-types
interface ExecutionContext extends WorkerExecutionContext {
  passThroughOnException(): void
  props: unknown
  exports: Record<string, unknown>
}

describe('evlog/workers ctx typing', () => {
  it('keeps the type of an annotated ctx', () => {
    const worker = withEvlog((_request, _env: unknown, ctx: ExecutionContext) => {
      ctx.passThroughOnException()
      return new Response(Object.keys(ctx.exports).join(','))
    })
    expectTypeOf(worker.fetch).parameter(2).toEqualTypeOf<ExecutionContext>()

    const handler = defineWorkerFetch((_request, _env: unknown, ctx: ExecutionContext) => new Response(String(ctx.props)))
    expectTypeOf(handler.fetch).parameter(2).toEqualTypeOf<ExecutionContext>()
  })

  it('types an unannotated ctx as WorkerExecutionContext', () => {
    const worker = withEvlog((_request, _env, ctx) => {
      expectTypeOf(ctx).toEqualTypeOf<WorkerExecutionContext>()
      return new Response('ok')
    })
    expectTypeOf(worker.fetch).parameter(2).toEqualTypeOf<WorkerExecutionContext>()
  })
})
