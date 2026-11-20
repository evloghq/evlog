const utf8 = new TextDecoder()

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LENGTH_DELIMITED = 2
const WIRE_FIXED32 = 5

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
    else if (wireType === WIRE_FIXED32) this.position += 4
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
      else if (fieldTag === (2 << 3 | WIRE_LENGTH_DELIMITED)) partialSuccess.errorMessage = utf8.decode(reader.lengthDelimited())
      else reader.skip(fieldTag & 7)
    }
  }
  return partialSuccess
}
