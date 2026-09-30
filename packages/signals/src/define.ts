/**
 * What a signal sees: the wide event in `enrich`, or the accumulated request
 * context (plus status, path, method and duration) in `keep`. Fields evlog
 * sets on every request are typed; everything else is what the app logged.
 */
export interface SignalInput extends Record<string, unknown> {
  status?: number
  path?: string
  method?: string
  durationMs?: number
  requestId?: string
}

/** Answer to a yes/no question. `confidence` is the probability of `value`. */
export interface BooleanVerdict {
  value: boolean
  confidence: number
}

/** Answer to a pick-one question. `confidence` is the probability of the chosen option. */
export interface ChoiceVerdict<TOption extends string = string> {
  value: TOption
  confidence: number
}

/**
 * Answer to a rubric question. `value` is the most likely level, `score` the
 * probability-weighted position between levels (`0` to `levels - 1`).
 */
export interface ScoreVerdict<TLevel extends string = string> {
  value: TLevel
  score: number
  confidence: number
}

export type Verdict = BooleanVerdict | ChoiceVerdict | ScoreVerdict

interface SignalBase<TVerdict extends Verdict> {
  /** Column name under `event.signals`. */
  name: string
  /**
   * Cheap predicate deciding whether the signal applies to an event. No
   * model call happens when it returns `false`. Required on signals with
   * `keep`, which otherwise would run on every request.
   */
  when?: (event: SignalInput) => boolean
  /** The question, in plain English. */
  ask: string
  /**
   * Promote the event past sampling when it returns `true`. Promote only:
   * `false` never drops an event that sampling would have kept.
   */
  keep?: (verdict: TVerdict) => boolean
  /**
   * Reuse a verdict across events sharing the same key, so an error storm
   * costs one call instead of thousands. Return `undefined` to skip caching.
   */
  cacheKey?: (event: SignalInput) => string | undefined
}

export interface BooleanSignalInput extends SignalBase<BooleanVerdict> {
  /** Optional description of what makes each answer true. */
  criteria?: { true?: string, false?: string }
}

export interface ChoiceSignalInput<TOption extends string> extends SignalBase<ChoiceVerdict<TOption>> {
  /** Options, each with the description the model matches against. */
  choice: Record<TOption, string>
}

export interface ScoreSignalInput<TLevel extends string> extends SignalBase<ScoreVerdict<TLevel>> {
  /** Ordered levels, lowest first. At least two. */
  score: readonly [TLevel, TLevel, ...TLevel[]]
}

export type SignalKind = 'boolean' | 'choice' | 'score'

/** A validated signal. Create with {@link defineSignal}. */
export interface Signal {
  kind: SignalKind
  name: string
  ask: string
  when?: (event: SignalInput) => boolean
  keep?(verdict: Verdict): boolean
  cacheKey?: (event: SignalInput) => string | undefined
  criteria?: { true?: string, false?: string }
  choice?: Record<string, string>
  score?: readonly string[]
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/i

/** Call signatures of {@link defineSignal}: the input shape selects the verdict type of `keep`. */
export interface DefineSignal {
  <TOption extends string>(signal: ChoiceSignalInput<TOption>): Signal
  <TLevel extends string>(signal: ScoreSignalInput<TLevel>): Signal
  (signal: BooleanSignalInput): Signal
}

/**
 * Declare a signal: a question the model answers about every event that
 * passes `when`, stored as a typed column with a confidence.
 *
 * The answer type follows the shape: `ask` alone is yes/no, `ask` + `choice`
 * picks one option, `ask` + `score` positions the event on a rubric.
 *
 * @example
 * ```ts
 * export const fault = defineSignal({
 *   name: 'fault',
 *   when: e => (e.status ?? 0) >= 400,
 *   ask: 'Who is responsible for this failure?',
 *   choice: {
 *     user: 'Bad input, expired session, client mistake',
 *     us: 'A bug or misconfiguration in our own code',
 *     upstream: 'A third-party dependency failed',
 *   },
 * })
 * ```
 */
export const defineSignal: DefineSignal = (signal: BooleanSignalInput | ChoiceSignalInput<string> | ScoreSignalInput<string>): Signal => {
  if (!NAME_PATTERN.test(signal.name)) {
    throw new Error(`[evlog/signals] invalid signal name "${signal.name}": use letters, digits and dashes, starting with a letter`)
  }
  if (!signal.ask.trim()) {
    throw new Error(`[evlog/signals] signal "${signal.name}" has an empty ask`)
  }
  if (signal.keep && !signal.when) {
    throw new Error(`[evlog/signals] signal "${signal.name}" has keep without when: a keep signal runs before sampling, so it needs a predicate`)
  }

  const base = {
    name: signal.name,
    ask: signal.ask,
    when: signal.when,
    keep: signal.keep,
    cacheKey: signal.cacheKey,
  }

  if ('choice' in signal) {
    if (Object.keys(signal.choice).length < 2) {
      throw new Error(`[evlog/signals] signal "${signal.name}" needs at least two options in choice`)
    }
    return { kind: 'choice', ...base, choice: signal.choice }
  }
  if ('score' in signal) {
    if (signal.score.length < 2) {
      throw new Error(`[evlog/signals] signal "${signal.name}" needs at least two levels in score`)
    }
    return { kind: 'score', ...base, score: signal.score }
  }
  return { kind: 'boolean', ...base, criteria: signal.criteria }
}
