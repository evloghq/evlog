/**
 * Custom keys that answer a product question rather than describing one run.
 *
 * "Which framework do people actually use?" is the reason this dashboard
 * exists, and it was losing to `initFilesWritten` in a list capped at the eight
 * busiest keys — a tool that reports forty counters buries its own headline.
 * These keys are pulled out before that cut and rendered as their own panels.
 *
 * Auto-imported (Nuxt `shared/utils/` convention); `mock-data.ts` imports it
 * explicitly because it is unit-tested outside Nitro's auto-import context.
 */

/**
 * Keys carrying a framework id, merged into one distribution.
 *
 * Two commands report it and they answer different questions — `init` is
 * intent at setup time, `map` is what people keep running afterwards — but
 * "which framework" wants both counted together.
 */
export const FRAMEWORK_FIELD_KEYS = ['initFramework', 'mapFramework'] as const

/** Key carrying the `map` grade band, rendered as the score distribution. */
export const GRADE_FIELD_KEY = 'mapGrade'

/** Grade bands in report order — worst last, so the panel reads like the CLI's own output. */
export const GRADE_ORDER = ['excellent', 'good', 'needs-work', 'at-risk'] as const

/** Key carrying the raw `map` score, bucketed into the score histogram. */
export const SCORE_FIELD_KEY = 'mapScore'

/** Every key promoted out of the generic breakdown. */
export const PROMOTED_FIELD_KEYS: readonly string[] = [
  ...FRAMEWORK_FIELD_KEYS,
  GRADE_FIELD_KEY,
  SCORE_FIELD_KEY,
]

/**
 * Raw score values into ten-point bins.
 *
 * The four grade bands say which side of a threshold a project fell on; they
 * cannot say whether it sat at 71 or 89, and that is the difference between a
 * band that is nearly met and one that is barely scraped. 100 belongs in the
 * top bin rather than a bin of its own.
 */
export function toScoreHistogram(values: FieldValueStat[]): { bin: number, label: string, count: number }[] {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    bin: i * 10,
    label: `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }))
  bins[9]!.label = '90–100'

  for (const value of values) {
    const score = Number(value.value)
    if (!Number.isFinite(score) || score < 0 || score > 100) continue
    bins[Math.min(9, Math.floor(score / 10))]!.count += value.count
  }

  return bins
}

/** Grade band a score falls into — mirrors `gradeFromScore()` in the CLI. */
export function gradeForScore(score: number): string {
  if (score >= 90) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'needs-work'
  return 'at-risk'
}

/**
 * Bands the framework timeline plots before the tail folds into `other`.
 *
 * One per framework the CLI can actually report (five today). Stacking more
 * near-identical fills than that is not a chart you can read — the tail is
 * more honest as a single `other` band than as more shades nobody can name.
 */
export const MAX_FRAMEWORK_SERIES = 5

/**
 * Fixed hue per framework, in slot order.
 *
 * Keyed by id rather than by position in the current series list: rank moves
 * when a filter is applied, and a reader who learned "Nuxt is indigo" must not
 * find it orange after narrowing to CI runs.
 */
const FRAMEWORK_COLORS: Record<string, string> = {
  'nuxt': 'var(--chart-cat-1)',
  'next': 'var(--chart-cat-2)',
  'nitro': 'var(--chart-cat-3)',
  'tanstack-start': 'var(--chart-cat-4)',
  'hono': 'var(--chart-cat-5)',
}

/**
 * Colour for a framework band.
 *
 * Ids the CLI cannot emit — legacy rows, another tool's vocabulary — share the
 * neutral. Handing them a categorical slot would mean the palette changes
 * meaning with the data, and there are only five validated slots to give.
 */
export function frameworkColor(framework: string): string {
  return FRAMEWORK_COLORS[framework] ?? 'var(--chart-cat-other)'
}

/** Whether a framework id has a categorical slot of its own. */
export function isKnownFramework(framework: string): boolean {
  return framework in FRAMEWORK_COLORS
}

/**
 * Series name a framework stacks under.
 *
 * Unknown ids collapse into one `other` band rather than each taking a band of
 * their own: they all share the neutral, and three separate bands painted the
 * same colour is a chart that looks like it has detail it cannot show. The
 * per-framework counts are still exact in the table underneath.
 */
export function frameworkSeries(framework: string): string {
  return isKnownFramework(framework) ? framework : OTHER_SERIES
}

/** Band the tail folds into — matches `OTHER_VERSION` in `adoption-shape`. */
export const OTHER_SERIES = 'other'

/* Nitro has no simple-icons glyph (`simple-icons:nitro` 404s); its official
   mark lives in the UnJS collection instead. */
const FRAMEWORK_ICONS: Record<string, string> = {
  'nuxt': 'i-simple-icons-nuxt',
  'next': 'i-simple-icons-nextdotjs',
  'nitro': 'i-unjs-nitro',
  'tanstack-start': 'i-simple-icons-tanstack',
  'hono': 'i-simple-icons-hono',
}

/** Icon for a framework id — unknown ids get a neutral package glyph. */
export function frameworkIcon(framework: string): string {
  return FRAMEWORK_ICONS[framework] ?? 'i-nucleo-box'
}

const FRAMEWORK_LABELS: Record<string, string> = {
  'nuxt': 'Nuxt',
  'next': 'Next.js',
  'nitro': 'Nitro',
  'tanstack-start': 'TanStack Start',
  'hono': 'Hono',
}

/** Display name for a framework id — ids arrive as CLI slugs. */
export function frameworkLabel(framework: string): string {
  return FRAMEWORK_LABELS[framework] ?? framework
}

const GRADE_LABELS: Record<string, string> = {
  'excellent': 'Excellent',
  'good': 'Good',
  'needs-work': 'Needs work',
  'at-risk': 'At risk',
}

export function gradeLabel(grade: string): string {
  return GRADE_LABELS[grade] ?? grade
}

/**
 * The score window each band covers, mirroring `gradeFromScore()` in the CLI
 * (`packages/cli/src/lib/map/score.ts`, thresholds 90 / 70 / 50).
 *
 * Shown next to every band because the words alone say nothing: "good" is a
 * judgement until you know it means 70–89, and a reader cannot tell whether a
 * distribution is healthy without the axis it is measured on.
 */
const GRADE_RANGES: Record<string, string> = {
  'excellent': '90–100',
  'good': '70–89',
  'needs-work': '50–69',
  'at-risk': '0–49',
}

export function gradeRange(grade: string): string | undefined {
  return GRADE_RANGES[grade]
}

/**
 * Which command a custom key came from, read off its prefix.
 *
 * One command reporting forty counters turns the breakdown into a wall the eye
 * slides off. Grouping restores the only structure the keys already have —
 * `mapFailWideEvent` and `mapSuppressedWideEvent` belong together, and neither
 * belongs next to `initDevDrain`.
 *
 * Prefix-based on purpose: it is a convention this dashboard reads, not a
 * registry it has to be told about, so a tool that adopts the same naming gets
 * the grouping for free and one that does not still renders in `Other`.
 */
const FIELD_GROUP_PREFIXES: { prefix: string, label: string }[] = [
  { prefix: 'map', label: 'map' },
  { prefix: 'init', label: 'init' },
  { prefix: 'agents', label: 'agents' },
  { prefix: 'doctor', label: 'doctor' },
  { prefix: 'checks', label: 'doctor' },
]

/** Fallback group for keys that match no known prefix. */
export const OTHER_FIELD_GROUP = 'other'

export function fieldGroup(key: string): string {
  const match = FIELD_GROUP_PREFIXES.find(
    // `mapped` must not match `map` — the prefix has to end at a word boundary.
    ({ prefix }) => key.startsWith(prefix) && /^[A-Z]/.test(key.slice(prefix.length)),
  )
  return match?.label ?? OTHER_FIELD_GROUP
}

/** Field stats bucketed by their reporting command, busiest group first. */
export function groupFieldStats<T extends { key: string, count: number }>(
  stats: T[],
): { group: string, fields: T[], count: number }[] {
  const byGroup = new Map<string, T[]>()
  for (const stat of stats) {
    const group = fieldGroup(stat.key)
    byGroup.set(group, [...(byGroup.get(group) ?? []), stat])
  }

  return [...byGroup.entries()]
    .map(([group, fields]) => ({
      group,
      fields,
      count: fields.reduce((sum, field) => sum + field.count, 0),
    }))
    /* `other` last regardless of volume — it is the leftovers bin, and letting
       it head the list would bury the groups that have a name. */
    .sort((a, b) => {
      if (a.group === OTHER_FIELD_GROUP) return 1
      if (b.group === OTHER_FIELD_GROUP) return -1
      return b.count - a.count || a.group.localeCompare(b.group)
    })
}

/**
 * Colour per grade band, so the distribution reads as a health gradient rather
 * than four interchangeable bars.
 */
export function gradeColor(grade: string): string {
  if (grade === 'excellent') return 'var(--ui-success)'
  if (grade === 'good') return 'var(--chart-accent)'
  if (grade === 'needs-work') return 'var(--ui-warning)'
  return 'var(--ui-error)'
}
