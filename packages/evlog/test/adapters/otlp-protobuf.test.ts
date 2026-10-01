import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { createOTLPDrain, sendBatchToOTLP } from '../../src/adapters/otlp'
import { encodeOTLPLogsRequest } from '../../src/adapters/otlp-protobuf'
import { EVLOG_VERSION } from '../../src/shared/http'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

type Field = { wireType: number, value: bigint | Uint8Array }

/** Protobuf wire-format reader: field number to its occurrences, nested messages left as bytes. */
function decode(bytes: Uint8Array): Map<number, Field[]> {
  const fields = new Map<number, Field[]>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const readVarint = (): bigint => {
    let result = 0n
    let shift = 0n
    for (;;) {
      const byte = bytes[offset++]
      if (byte === undefined) throw new Error('truncated varint')
      result |= BigInt(byte & 0x7F) << shift
      if ((byte & 0x80) === 0) return result
      shift += 7n
    }
  }
  while (offset < bytes.length) {
    const tag = Number(readVarint())
    const wireType = tag & 7
    const fieldNumber = tag >>> 3
    let value: bigint | Uint8Array
    if (wireType === 0) {
      value = readVarint()
    } else if (wireType === 1) {
      value = bytes.slice(offset, offset + 8)
      offset += 8
    } else if (wireType === 2) {
      const length = Number(readVarint())
      value = bytes.slice(offset, offset + length)
      offset += length
    } else if (wireType === 5) {
      value = bytes.slice(offset, offset + 4)
      offset += 4
    } else {
      throw new Error(`unexpected wire type ${wireType}`)
    }
    expect(offset).toBeLessThanOrEqual(view.byteLength)
    const list = fields.get(fieldNumber) ?? []
    list.push({ wireType, value })
    fields.set(fieldNumber, list)
  }
  return fields
}

function bytesOf(fields: Map<number, Field[]>, field: number): Uint8Array[] {
  return (fields.get(field) ?? []).map((entry) => {
    expect(entry.wireType).toBe(2)
    return entry.value as Uint8Array
  })
}

function one(fields: Map<number, Field[]>, field: number): Uint8Array {
  const [value] = bytesOf(fields, field)
  expect(value).toBeDefined()
  return value as Uint8Array
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const fixed64 = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true)

function varint(fields: Map<number, Field[]>, field: number): bigint | undefined {
  const entry = fields.get(field)?.[0]
  if (!entry) return undefined
  expect(entry.wireType).toBe(0)
  return entry.value as bigint
}

/** Decode an `AnyValue` back to the OTLP/JSON shape the JSON encoder emits. */
function anyValue(bytes: Uint8Array): unknown {
  const fields = decode(bytes)
  if (fields.has(1)) return { stringValue: text(one(fields, 1)) }
  if (fields.has(2)) return { boolValue: varint(fields, 2) === 1n }
  if (fields.has(3)) return { intValue: String(BigInt.asIntN(64, varint(fields, 3) ?? 0n)) }
  if (fields.has(4)) {
    const raw = fields.get(4)?.[0]?.value as Uint8Array
    return { doubleValue: new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true) }
  }
  if (fields.has(5)) return { arrayValue: { values: bytesOf(decode(one(fields, 5)), 1).map(anyValue) } }
  if (fields.has(6)) return { kvlistValue: { values: bytesOf(decode(one(fields, 6)), 1).map(keyValue) } }
  throw new Error('empty AnyValue')
}

function keyValue(bytes: Uint8Array): { key: string, value: unknown } {
  const fields = decode(bytes)
  return { key: text(one(fields, 1)), value: anyValue(one(fields, 2)) }
}

describe('otlp protobuf encoding', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const createTestEvent = (overrides?: Partial<WideEvent>): WideEvent => ({
    timestamp: '2024-01-01T12:00:00.000Z',
    level: 'error',
    service: 'checkout',
    environment: 'production',
    ...overrides,
  })

  const sentBody = (): Uint8Array => {
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBeInstanceOf(Uint8Array)
    return init.body as Uint8Array
  }

  /** Walk `ExportLogsServiceRequest` down to its first resource, scope and log record. */
  const firstRecord = (body: Uint8Array) => {
    const resourceLogs = decode(one(decode(body), 1))
    const resource = decode(one(resourceLogs, 1))
    const scopeLogs = decode(one(resourceLogs, 2))
    return {
      resourceAttributes: bytesOf(resource, 1).map(keyValue),
      scope: decode(one(scopeLogs, 1)),
      record: decode(one(scopeLogs, 2)),
    }
  }

  it('encodes resource, scope and record fields at their OTLP field numbers', async () => {
    await sendBatchToOTLP([createTestEvent({ traceId: TRACE_ID, spanId: SPAN_ID, method: 'POST' })], {
      endpoint: 'http://localhost:4318',
      protocol: 'http/protobuf',
    })

    const { resourceAttributes, scope, record } = firstRecord(sentBody())

    expect(resourceAttributes).toContainEqual({ key: 'service.name', value: { stringValue: 'checkout' } })
    expect(resourceAttributes).toContainEqual({ key: 'deployment.environment', value: { stringValue: 'production' } })
    expect(text(one(scope, 1))).toBe('evlog')
    expect(text(one(scope, 2))).toBe(EVLOG_VERSION)

    const [time] = record.get(1) ?? []
    expect(time?.wireType).toBe(1)
    expect(fixed64(time?.value as Uint8Array)).toBe(BigInt(Date.parse('2024-01-01T12:00:00.000Z')) * 1_000_000n)
    expect(varint(record, 2)).toBe(17n)
    expect(text(one(record, 3))).toBe('ERROR')
    expect(JSON.parse(text(one(decode(one(record, 5)), 1)))).toMatchObject({ method: 'POST' })
    expect(bytesOf(record, 6).map(keyValue)).toContainEqual({ key: 'method', value: { stringValue: 'POST' } })
    expect(hex(one(record, 9))).toBe(TRACE_ID)
    expect(hex(one(record, 10))).toBe(SPAN_ID)
  })

  it('round-trips every attribute value type the JSON encoder emits', async () => {
    const event = createTestEvent({
      count: 42,
      negative: -7,
      big: 9_007_199_254_740_991,
      ratio: 0.25,
      ok: false,
      empty: '',
      zero: 0,
      emoji: 'café ☕',
      tags: ['a', 'b'],
      scores: [1, 2.5],
      user: { id: 'usr_1', plan: { seats: 3 } },
    })

    await sendBatchToOTLP([event], { endpoint: 'http://localhost:4318', protocol: 'http/protobuf' })
    const attributes = bytesOf(firstRecord(sentBody()).record, 6).map(keyValue)

    expect(attributes).toEqual(expect.arrayContaining([
      { key: 'count', value: { intValue: '42' } },
      { key: 'negative', value: { intValue: '-7' } },
      { key: 'big', value: { intValue: '9007199254740991' } },
      { key: 'ratio', value: { doubleValue: 0.25 } },
      { key: 'ok', value: { boolValue: false } },
      { key: 'empty', value: { stringValue: '' } },
      { key: 'zero', value: { intValue: '0' } },
      { key: 'emoji', value: { stringValue: 'café ☕' } },
      { key: 'tags', value: { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } } },
      { key: 'scores', value: { arrayValue: { values: [{ doubleValue: 1 }, { doubleValue: 2.5 }] } } },
      {
        key: 'user',
        value: {
          kvlistValue: {
            values: [
              { key: 'id', value: { stringValue: 'usr_1' } },
              { key: 'plan', value: { kvlistValue: { values: [{ key: 'seats', value: { intValue: '3' } }] } } },
            ],
          },
        },
      },
    ]))
  })

  it('encodes length prefixes longer than one varint byte', () => {
    const long = 'x'.repeat(300)
    const body = encodeOTLPLogsRequest({
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: 'evlog' },
              logRecords: [
                {
                  timeUnixNano: '1',
                  severityNumber: 9,
                  severityText: 'INFO',
                  body: { stringValue: long },
                  attributes: [],
                }
              ],
            }
          ],
        }
      ],
    })

    const { record } = firstRecord(body)
    expect(text(one(decode(one(record, 5)), 1))).toBe(long)
  })

  it('omits trace fields when the event has no valid ids', async () => {
    await sendBatchToOTLP([createTestEvent()], { endpoint: 'http://localhost:4318', protocol: 'http/protobuf' })
    const { record } = firstRecord(sentBody())

    expect(record.has(9)).toBe(false)
    expect(record.has(10)).toBe(false)
  })

  it('posts with the protobuf content type', async () => {
    await sendBatchToOTLP([createTestEvent()], { endpoint: 'http://localhost:4318', protocol: 'http/protobuf' })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:4318/v1/logs')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-protobuf')
  })

  it('gzips a protobuf body', async () => {
    await sendBatchToOTLP([createTestEvent()], {
      endpoint: 'http://localhost:4318',
      protocol: 'http/protobuf',
      compression: 'gzip',
    })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('gzip')
    const { resourceAttributes } = firstRecord(new Uint8Array(gunzipSync(init.body as Uint8Array)))
    expect(resourceAttributes).toContainEqual({ key: 'service.name', value: { stringValue: 'checkout' } })
  })

  describe('createOTLPDrain', () => {
    beforeEach(() => {
      for (const key of ['NUXT_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_PROTOCOL', 'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']) {
        vi.stubEnv(key, undefined)
      }
      vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
    })

    it('uses protobuf when protocol is http/protobuf', async () => {
      const drain = createOTLPDrain({ protocol: 'http/protobuf' })
      await drain({ event: createTestEvent() })

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-protobuf')
      expect(firstRecord(sentBody()).resourceAttributes)
        .toContainEqual({ key: 'service.name', value: { stringValue: 'checkout' } })
    })

    it('reads OTEL_EXPORTER_OTLP_PROTOCOL', async () => {
      vi.stubEnv('OTEL_EXPORTER_OTLP_PROTOCOL', 'http/protobuf')
      await createOTLPDrain()({ event: createTestEvent() })

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-protobuf')
    })

    it('lets OTEL_EXPORTER_OTLP_LOGS_PROTOCOL override the generic protocol', async () => {
      vi.stubEnv('OTEL_EXPORTER_OTLP_PROTOCOL', 'http/protobuf')
      vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_PROTOCOL', 'http/json')
      await createOTLPDrain()({ event: createTestEvent() })

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect(typeof init.body).toBe('string')
    })

    it('logs an error and skips fetch on an unsupported protocol', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.stubEnv('OTEL_EXPORTER_OTLP_PROTOCOL', 'grpc')
      await createOTLPDrain()({ event: createTestEvent() })

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Unsupported protocol "grpc"'))
    })
  })
})
