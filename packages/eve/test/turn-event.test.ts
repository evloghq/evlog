import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isError } from '../extension/lib/vendor/logs-query'

const run = promisify(execFile)
const fixture = join(import.meta.dirname, 'fixture')
const nodeMajor = Number(process.versions.node.split('.')[0])

interface TurnEvent {
  [key: string]: unknown
  level: string
  status: number
  requestId: string
  idempotencyKey: string
  traceId?: string
  spanId?: string
  eve: { sessionId: string, turnId: string, outcome: string, failedCalls?: number, caller?: { principalType: string } }
  order: { id: string }
  customer: { email: string }
  audit?: { action: string, target: { id: string } }
  error?: { name: string, message: string, code: string, status: number, why: string, fix: string, stack: string }
  gen_ai: {
    operation: { name: string }
    conversation: { id: string }
    calls: number
    response: { finish_reasons: string[] }
    usage: { input_tokens: number, output_tokens: number, total_tokens: number }
    tools: Array<{ call_id: string, name: string, success: boolean, error?: string, code?: string, why?: string, fix?: string }>
  }
}

interface OtlpTrace {
  resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string, spanId: string, attributes: Array<{ key: string, value: unknown }> }> }> }>
}

// The fixture agent answers from a scripted model, so `eve eval` drives the
// real extension through eve's runtime without a model provider.
describe.skipIf(nodeMajor < 24)('@evlog/eve turn event', () => {
  const logs = mkdtempSync(join(tmpdir(), 'evlog-eve-'))
  let events: TurnEvent[] = []

  beforeAll(async () => {
    await run(join(import.meta.dirname, '../node_modules/.bin/eve'), ['eval'], {
      cwd: fixture,
      // Under Vitest's NODE_ENV=test the fixture agent never reaches its tool.
      env: { ...process.env, NODE_ENV: 'development', EVE_TELEMETRY_DISABLED: '1', EVLOG_FIXTURE_LOGS: logs },
    })
    events = readdirSync(logs).filter(file => file.endsWith('.jsonl')).flatMap(file =>
      readFileSync(join(logs, file), 'utf8').trim().split('\n').map(line => JSON.parse(line) as TurnEvent))
  }, 180_000)

  afterAll(() => rmSync(logs, { recursive: true, force: true }))

  const byOrder = (id: string) => {
    const event = events.find(e => e.order?.id === id)
    expect(event, `no event for order ${id}`).toBeDefined()
    return event!
  }

  it('emits one event per turn, keyed by session and turn', () => {
    expect(events).toHaveLength(6)
    for (const event of events) {
      expect(event.requestId).toBe(`${event.eve.sessionId}:${event.eve.turnId}`)
      expect(event.idempotencyKey).toBe(event.requestId)
      expect(event.gen_ai.conversation.id).toBe(event.eve.sessionId)
      expect(event.gen_ai.operation.name).toBe('invoke_agent')
    }
  })

  const spansOf = (event: TurnEvent) => {
    const segments = join(fixture, '.eve/traces/v1', event.traceId ?? 'missing', 'segments')
    return readdirSync(segments).flatMap(file =>
      (JSON.parse(readFileSync(join(segments, file), 'utf8')) as OtlpTrace).resourceSpans
        .flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans)))
  }

  it('carries the trace and invoke_agent span eve recorded for the turn', () => {
    for (const event of events) {
      const spans = spansOf(event)
      const root = spans.find(span => span.name.startsWith('invoke_agent '))
      expect(root?.spanId).toBe(event.spanId)
      expect(root?.attributes).toContainEqual({ key: 'agent.turn.id', value: { stringValue: event.eve.turnId } })
    }
  })

  it('reports one finish reason per model call and the tool calls', () => {
    const event = byOrder('9001')
    expect(event.gen_ai.calls).toBe(2)
    expect(event.gen_ai.response.finish_reasons).toEqual(['tool-calls', 'stop'])
    expect(event.gen_ai.usage.total_tokens).toBe(event.gen_ai.usage.input_tokens + event.gen_ai.usage.output_tokens)
    expect(event.gen_ai.tools).toEqual([expect.objectContaining({ name: 'issue_refund', success: true })])
    expect(event.level).toBe('info')
    expect(event.error).toBeUndefined()
  })

  it('records an audit entry a tool adds', () => {
    expect(byOrder('9001').audit).toMatchObject({ action: 'refund.issued', target: { id: '9001' } })
  })

  it('redacts the fields a tool adds, in development too', () => {
    expect(byOrder('9001').customer.email).toBe('j***@***.com')
  })

  it('keeps the catalog fields of an error the tool threw', () => {
    const event = byOrder('bad')
    expect(event.error).toMatchObject({
      code: 'REFUND_DECLINED',
      status: 402,
      why: 'The card issuer rejected the reversal',
      fix: 'Ask the customer for another payment method',
    })
    // The stack is the tool's, not the hook's that wrote the event.
    expect(event.error!.stack.split('\n')[1]).toContain('execute')
    expect(event.error!.stack).not.toContain('emitTurn')
    expect(event.gen_ai.tools).toEqual([
      expect.objectContaining({
        name: 'issue_refund',
        success: false,
        code: 'REFUND_DECLINED',
        why: 'The card issuer rejected the reversal',
        fix: 'Ask the customer for another payment method',
      })
    ])
  })

  it('names each tool call by the id on its execute_tool span', () => {
    for (const event of events.filter(e => e.gen_ai.tools)) {
      const ids = spansOf(event)
        .filter(span => span.name.startsWith('execute_tool '))
        .flatMap(span => span.attributes.filter(a => a.key === 'gen_ai.tool.call.id').map(a => (a.value as { stringValue: string }).stringValue))
      expect(event.gen_ai.tools.map(tool => tool.call_id).sort()).toEqual(ids.sort())
    }
  })

  // The logs-errors eval gates on the tool's output: this session's declined refund, and only it.
  it('reads the session back through the logs tool on its next turn', () => {
    const read = events.find(e => e.gen_ai.tools.some(tool => tool.name === 'evlog__logs'))
    expect(read?.eve.turnId).toBe('turn_1')
    expect(read?.gen_ai.tools).toEqual([expect.objectContaining({ name: 'evlog__logs', success: true })])
    expect(events.filter(e => e.eve.sessionId === read?.eve.sessionId).map(e => e.error?.code)).toEqual(['REFUND_DECLINED', undefined])
  })

  it('writes a recovered plain Error as the error block, so the errors view lists the turn', () => {
    const event = byOrder('plain')
    expect(event.level).toBe('warn')
    expect(event.status).toBe(200)
    expect(event.error).toEqual({ name: 'Error', message: 'Refund service timed out' })
    expect(event.gen_ai.tools).toEqual([expect.objectContaining({ name: 'issue_refund', success: false, error: 'Refund service timed out' })])
    expect(isError(event as never)).toBe(true)
  })

  it('leaves out per-call codes when two failed calls share a message and the errors behind them differ', () => {
    const event = events.find(e => e.gen_ai.tools?.length === 2)
    expect(event, 'no event for the two declined refunds').toBeDefined()
    expect(event!.gen_ai.tools).toHaveLength(2)
    for (const tool of event!.gen_ai.tools) {
      expect(tool).toMatchObject({ success: false, error: 'Refund declined' })
      expect(tool).not.toHaveProperty('code')
      expect(tool).not.toHaveProperty('why')
    }
  })

  it('records a logs call\'s shape and counts with diagnostics on, and none of what it returned', () => {
    const read = events.find(e => e.gen_ai.tools.some(tool => tool.name === 'evlog__logs'))!
    const [callId] = read.gen_ai.tools.map(tool => tool.call_id)
    const recorded = (read as { evlog?: { logs?: Record<string, Record<string, unknown>> } }).evlog?.logs?.[callId!]
    expect(recorded).toMatchObject({ source: 'files', view: 'errors', input: { view: 'errors', where: [expect.any(String)] }, matched: 1, returned: 1, complete: true })
    expect(JSON.stringify(recorded)).not.toContain('ops@clearbill.dev')
    expect(recorded).not.toHaveProperty('rows')
    expect(JSON.stringify(read)).not.toContain('The card issuer rejected the reversal')
  })

  it('marks a completed turn with a failed call as a warning', () => {
    const event = byOrder('bad')
    expect(event.eve.outcome).toBe('completed')
    expect(event.eve.failedCalls).toBe(1)
    expect(event.status).toBe(200)
    expect(event.level).toBe('warn')
  })
})
