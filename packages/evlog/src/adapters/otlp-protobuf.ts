import type { OtlpAttributeValue } from '../shared/event'
import type { OTLPExportLogsRequest, OTLPLogRecord } from './otlp'

const utf8 = new TextEncoder()
const utf8Decoder = new TextDecoder()

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LENGTH_DELIMITED = 2

class ProtoWriter {
  private buffer: Uint8Array<ArrayBuffer>
  private view: DataView
  private position = 0

  constructor(size = 64) {
    this.buffer = new Uint8Array(size)
    this.view = new DataView(this.buffer.buffer)
  }

  private reserve(bytes: number): void {
    if (this.position + bytes <= this.buffer.length) return
    let size = this.buffer.length * 2
    while (size < this.position + bytes) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buffer.subarray(0, this.position))
    this.buffer = next
    this.view = new DataView(next.buffer)
  }

  /** Unsigned varint for non-negative safe integers. */
  varint(value: number): void {
    this.reserve(10)
    let rest = value
    while (rest > 0x7F) {
      this.buffer[this.position++] = (rest & 0x7F) | 0x80
      rest = Math.floor(rest / 128)
    }
    this.buffer[this.position++] = rest
  }

  /** int64 varint: negative values take ten bytes in two's complement. */
  int64(value: bigint): void {
    this.reserve(10)
    let rest = BigInt.asUintN(64, value)
    while (rest > 0x7Fn) {
      this.buffer[this.position++] = Number(rest & 0x7Fn) | 0x80
      rest >>= 7n
    }
    this.buffer[this.position++] = Number(rest)
  }

  tag(field: number, wireType: number): void {
    this.varint(field * 8 + wireType)
  }

  bytes(field: number, data: Uint8Array): void {
    this.tag(field, WIRE_LENGTH_DELIMITED)
    this.varint(data.length)
    this.reserve(data.length)
    this.buffer.set(data, this.position)
    this.position += data.length
  }

  string(field: number, value: string): void {
    this.bytes(field, utf8.encode(value))
  }

  fixed64(field: number, value: bigint): void {
    this.tag(field, WIRE_FIXED64)
    this.reserve(8)
    this.view.setBigUint64(this.position, value, true)
    this.position += 8
  }

  double(field: number, value: number): void {
    this.tag(field, WIRE_FIXED64)
    this.reserve(8)
    this.view.setFloat64(this.position, value, true)
    this.position += 8
  }

  message(field: number, write: (writer: ProtoWriter) => void): void {
    const inner = new ProtoWriter()
    write(inner)
    this.bytes(field, inner.finish())
  }

  finish(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.position)
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

// Field numbers follow opentelemetry/proto/common/v1/common.proto.
function writeAnyValue(writer: ProtoWriter, value: OtlpAttributeValue): void {
  if ('stringValue' in value) {
    writer.string(1, value.stringValue)
  } else if ('boolValue' in value) {
    writer.tag(2, WIRE_VARINT)
    writer.varint(value.boolValue ? 1 : 0)
  } else if ('intValue' in value) {
    writer.tag(3, WIRE_VARINT)
    writer.int64(BigInt(value.intValue))
  } else if ('doubleValue' in value) {
    writer.double(4, value.doubleValue)
  } else if ('arrayValue' in value) {
    writer.message(5, (array) => {
      for (const item of value.arrayValue.values) array.message(1, inner => writeAnyValue(inner, item))
    })
  } else {
    writer.message(6, (list) => {
      for (const entry of value.kvlistValue.values) list.message(1, inner => writeKeyValue(inner, entry))
    })
  }
}

function writeKeyValue(writer: ProtoWriter, entry: { key: string, value: OtlpAttributeValue }): void {
  writer.string(1, entry.key)
  writer.message(2, inner => writeAnyValue(inner, entry.value))
}

// Field numbers follow opentelemetry/proto/logs/v1/logs.proto.
function writeLogRecord(writer: ProtoWriter, record: OTLPLogRecord): void {
  writer.fixed64(1, BigInt(record.timeUnixNano))
  writer.tag(2, WIRE_VARINT)
  writer.varint(record.severityNumber)
  writer.string(3, record.severityText)
  writer.message(5, inner => writeAnyValue(inner, record.body))
  for (const attribute of record.attributes) writer.message(6, inner => writeKeyValue(inner, attribute))
  if (record.traceId) writer.bytes(9, hexToBytes(record.traceId))
  if (record.spanId) writer.bytes(10, hexToBytes(record.spanId))
}

/**
 * Encode an OTLP logs export request as `application/x-protobuf`, the
 * `http/protobuf` OTLP transport. `createOTLPDrain({ protocol: 'http/protobuf' })`
 * loads this module on demand, so JSON-only deployments never bundle it.
 */
export function encodeOTLPLogsRequest(request: OTLPExportLogsRequest): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter(1024)
  for (const resourceLogs of request.resourceLogs) {
    writer.message(1, (resourceWriter) => {
      resourceWriter.message(1, (resource) => {
        for (const attribute of resourceLogs.resource.attributes) resource.message(1, inner => writeKeyValue(inner, attribute))
      })
      for (const scopeLogs of resourceLogs.scopeLogs) {
        resourceWriter.message(2, (scopeWriter) => {
          scopeWriter.message(1, (scope) => {
            scope.string(1, scopeLogs.scope.name)
            if (scopeLogs.scope.version) scope.string(2, scopeLogs.scope.version)
          })
          for (const record of scopeLogs.logRecords) scopeWriter.message(2, inner => writeLogRecord(inner, record))
        })
      }
    })
  }
  return writer.finish()
}

class ProtoReader {
  private position = 0

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.position >= this.bytes.length
  }

  /** Unsigned varint, exact up to `Number.MAX_SAFE_INTEGER`. */
  varint(): number {
    let value = 0
    let scale = 1
    let byte: number | undefined
    do {
      byte = this.bytes[this.position++]
      if (byte === undefined) throw new Error('Truncated protobuf varint')
      value += (byte & 0x7F) * scale
      scale *= 128
    } while (byte & 0x80)
    return value
  }

  lengthDelimited(): Uint8Array {
    const length = this.varint()
    if (this.position + length > this.bytes.length) throw new Error('Truncated protobuf field')
    const field = this.bytes.subarray(this.position, this.position + length)
    this.position += length
    return field
  }

  skip(wireType: number): void {
    if (wireType === WIRE_VARINT) this.varint()
    else if (wireType === WIRE_FIXED64) this.position += 8
    else if (wireType === WIRE_LENGTH_DELIMITED) this.lengthDelimited()
    else if (wireType === 5) this.position += 4
    else throw new Error(`Unsupported protobuf wire type ${wireType}`)
  }
}

/** `ExportLogsPartialSuccess` of an OTLP logs export response. */
export interface OTLPPartialSuccess {
  rejectedLogRecords: number
  errorMessage: string
}

/**
 * Read `partial_success` from an `application/x-protobuf`
 * `ExportLogsServiceResponse`. Returns `undefined` when the collector sent
 * none, and throws on a truncated message.
 */
export function decodeOTLPPartialSuccess(bytes: Uint8Array): OTLPPartialSuccess | undefined {
  const response = new ProtoReader(bytes)
  let partialSuccess: OTLPPartialSuccess | undefined
  while (!response.done) {
    const tag = response.varint()
    if (tag !== (1 << 3 | WIRE_LENGTH_DELIMITED)) {
      response.skip(tag & 7)
      continue
    }
    const reader = new ProtoReader(response.lengthDelimited())
    partialSuccess = { rejectedLogRecords: 0, errorMessage: '' }
    while (!reader.done) {
      const fieldTag = reader.varint()
      if (fieldTag === (1 << 3 | WIRE_VARINT)) partialSuccess.rejectedLogRecords = reader.varint()
      else if (fieldTag === (2 << 3 | WIRE_LENGTH_DELIMITED)) partialSuccess.errorMessage = utf8Decoder.decode(reader.lengthDelimited())
      else reader.skip(fieldTag & 7)
    }
  }
  return partialSuccess
}
