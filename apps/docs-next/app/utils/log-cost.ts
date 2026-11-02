/**
 * The log cost model, shared by the calculator on `/reference/cost` and the
 * `estimate-log-cost` MCP tool so both answer with the same arithmetic.
 */

export interface LogCostProvider {
  id: string
  name: string
  icon: string
  /** USD per gigabyte ingested. */
  perGb: number
  /** USD per million events indexed. Zero when the provider does not meter events. */
  perMillionIndexed: number
  note: string
}

/**
 * Published list rates, in USD, as read on {@link PRICES_READ_ON}. They are
 * starting points a caller overwrites: both the panel and the tool take the
 * rates as inputs, so a stale figure costs a correction rather than a wrong
 * answer.
 */
export const PRICES_READ_ON = '14 August 2026'

export const LOG_COST_PROVIDERS: LogCostProvider[] = [
  { id: 'datadog', name: 'Datadog', icon: 'i-simple-icons-datadog', perGb: 0.10, perMillionIndexed: 1.70, note: 'ingest + indexing, 15-day retention' },
  { id: 'grafana', name: 'Grafana', icon: 'i-simple-icons-grafana', perGb: 0.50, perMillionIndexed: 0, note: 'Loki ingest' },
  { id: 'sentry', name: 'Sentry', icon: 'i-simple-icons-sentry', perGb: 0.50, perMillionIndexed: 0, note: 'beyond the 5 GB included' },
  { id: 'posthog', name: 'PostHog', icon: 'i-simple-icons-posthog', perGb: 0.25, perMillionIndexed: 0, note: '50-300 GB tier' },
  { id: 'betterstack', name: 'Better Stack', icon: 'i-simple-icons-betterstack', perGb: 0.15, perMillionIndexed: 0, note: 'ingest, before retention' },
  { id: 'axiom', name: 'Axiom', icon: 'i-custom-axiom', perGb: 0.12, perMillionIndexed: 0, note: 'credits per GB loaded' },
]

/**
 * Bytes of serialized JSON per shape, measured by running the checkout request
 * documented on `/reference/cost` through pino 10 and evlog: 4 lines totalling
 * 736 bytes against 1 event of 322 bytes. The line figure is the mean of four.
 */
export const PINO_LINE_BYTES = 184
export const EVLOG_EVENT_BYTES = 322

export interface LogCostShape {
  events: number
  gb: number
  cost: number
}

export interface LogCostEstimate {
  before: LogCostShape
  after: LogCostShape
  saved: number
  savedRatio: number
}

export interface LogCostInput {
  requestsPerMonth: number
  /** Log lines the current logger writes per request. */
  linesPerRequest: number
  perGb: number
  perMillionIndexed: number
  /**
   * Fraction of traffic kept after sampling, `1` for none. Applied to both
   * shapes: any logger can drop events, so sampling lowers both bills and
   * leaves the ratio between them alone.
   */
  keepRatio?: number
}

/** Cents below $100, where whole dollars would stop the figures adding up. */
function precision(cost: number) {
  return cost < 100 ? 2 : 0
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Prices one month of logs in both shapes.
 *
 * Costs are rounded to the precision they are reported at before the saving is
 * taken from them, so the three figures agree wherever they are displayed.
 *
 * @param input - Traffic and the provider's rates
 * @returns Both shapes, the saving, and the saving as a ratio of the current bill
 */
export function estimateLogCost(input: LogCostInput): LogCostEstimate {
  const kept = input.keepRatio ?? 1
  const beforeEvents = input.requestsPerMonth * input.linesPerRequest * kept
  const afterEvents = input.requestsPerMonth * kept
  const bill = (events: number, bytes: number) =>
    (events * bytes / 1e9) * input.perGb + (events / 1e6) * input.perMillionIndexed

  const digits = precision(bill(beforeEvents, PINO_LINE_BYTES))
  const before = {
    events: beforeEvents,
    gb: beforeEvents * PINO_LINE_BYTES / 1e9,
    cost: round(bill(beforeEvents, PINO_LINE_BYTES), digits),
  }
  const after = {
    events: afterEvents,
    gb: afterEvents * EVLOG_EVENT_BYTES / 1e9,
    cost: round(bill(afterEvents, EVLOG_EVENT_BYTES), digits),
  }
  // Rounded again: subtracting two rounded floats reintroduces binary noise,
  // which a formatter would hide but a structured consumer would not.
  const saved = Math.max(0, round(before.cost - after.cost, digits))
  return { before, after, saved, savedRatio: before.cost === 0 ? 0 : saved / before.cost }
}
