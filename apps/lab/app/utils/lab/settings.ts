/**
 * The lab's parameter set, its presets, and URL round-tripping.
 *
 * Every knob lives in one flat object so a shot is fully described by a URL —
 * paste it back and you get the exact same frame. That is what makes a take
 * reproducible a month later when the component has changed and the release
 * video needs a reshoot.
 */

/**
 * Screens the finished frame can be redrawn through.
 *
 * One at a time rather than a stack of toggles: these all resample the picture
 * onto a grid of cells, and two of them fighting over the same cell produces
 * mush rather than a combination. Everything that *does* combine — the lens, the
 * grade, the lens — stays a separate control.
 */
export const STYLIZE_MODES = ['none', 'dither', 'ascii', 'halftone', 'posterize', 'crt'] as const

export type StylizeMode = typeof STYLIZE_MODES[number]

/** Glyph ramps for the ascii screen. The strings themselves live in `ascii.ts`. */
export const ASCII_SETS = ['ascii', 'blocks', 'shades', 'code'] as const

export type AsciiSet = typeof ASCII_SETS[number]

export interface LabSettings {
  /**
   * The viewport the component is laid out in, in CSS pixels.
   *
   * Set by the device presets rather than typed: this is the width a responsive
   * component reads to decide its layout, so the useful values are the ones real
   * screens have.
   */
  stageWidth: number
  stageHeight: number
  /** Output frame size, set by the delivery presets. */
  outputWidth: number
  outputHeight: number
  /** Frame rate of the export, one of `FRAME_RATES`. */
  fps: number
  /**
   * How far into the component's own timeline the lab can scrub, in ms.
   *
   * The components loop on their own schedule and never announce a length, so
   * this is the window being inspected rather than anything they report.
   */
  timelineLength: number
  /**
   * Extra time after the last clip, in ms.
   *
   * The timeline cannot be shorter than its content — that is what left the
   * playhead past every layer on a black frame. Longer is a deliberate choice:
   * a beat of black to land on after a fade out.
   */
  tail: number

  /** Container for the exported video. */
  container: string
  /**
   * Animation playback rate. Below 1 the component is stepped in smaller
   * increments per frame, so the same take covers less of the sequence and
   * plays back slower — real slow motion, not frame duplication.
   */
  speed: number

  // Camera
  pitch: number
  yaw: number
  roll: number
  /** Framing, relative to the distance that fits the plane exactly. 1 = edge to edge. */
  zoom: number
  fov: number
  panX: number
  panY: number

  // Focus
  /** Focal plane across the plate's own depth span. 0 = nearest edge, 1 = farthest. */
  focus: number
  /** Half-width of the sharp band, in that same 0..1 span. Small = razor thin. */
  focusRange: number
  /** Maximum bokeh radius, in pixels of a 1080p frame; scaled to the real one. */
  aperture: number
  blurRadius: number
  /**
   * Sides of the aperture. 0 is a perfect disc; 5 or 6 is what a real iris does.
   *
   * The one thing that makes an out-of-focus highlight read as photographed
   * rather than as a blur: a circular kernel is what every naive depth-of-field
   * produces, and it is the reason they all look like the same effect.
   */
  bokehBlades: number
  /**
   * Optical vignetting: how far the bokeh is clipped into a lens shape towards
   * the corners. A real barrel occludes off-axis rays, so a round highlight at
   * the edge of the frame is squeezed into a lens — the cat's eye.
   */
  bokehCatEye: number
  /**
   * Field curvature, as a whirlpool.
   *
   * An uncorrected field draws an off-axis highlight as an arc rather than a
   * circle, and the arcs sweep around the frame. It is the one lens defect
   * nobody tries to remove.
   */
  bokehSwirl: number
  /** Squeezes the bokeh into a standing oval, the way an anamorphic front does. */
  bokehSqueeze: number
  /**
   * How far the plane of sharpness leans away from the sensor, and about which
   * axis. Zero is the parallel plane every ordinary lens is stuck with.
   */
  focusTilt: number
  focusTiltAngle: number

  // Bloom
  bloomIntensity: number
  bloomThreshold: number
  bloomRadius: number
  /** Horizontal flare across the highlights, the way an anamorphic lens streaks. */
  streaks: number
  /** Internal reflections thrown back across the centre from what is bright. */
  ghosts: number
  /**
   * A net or mist filter: the picture mixed towards a blurred copy of itself.
   *
   * The one effect here that takes contrast away rather than adding light. It is
   * what veils the blacks around a highlight instead of merely brightening it,
   * and it is the closest thing in the lens to what "dreamy" usually means.
   */
  diffusion: number
  /** Diffraction spikes off the highlights, from a filter with grooves etched in it. */
  starIntensity: number
  /** Arms on that star. Four is two crossed sets of grooves, six is three. */
  starPoints: number
  starAngle: number
  /** How far the spikes reach. */
  starLength: number

  // Lens
  /**
   * Barrel (positive) or pincushion (negative) distortion.
   *
   * Geometric, so it bends the whole picture rather than tinting it — a fisheye
   * at the top of the range, and the curvature a CRT needs at a tenth of it.
   */
  distortion: number
  /** How far the colour channels are pulled apart towards the edges. */
  aberration: number
  /**
   * Whether that split is three channels or a continuous spectrum.
   *
   * At zero the frame is sampled once per channel, which is what a lens does and
   * what reads as a clean fringe. Above it the split is integrated across a band
   * of wavelengths instead, which smears the fringe into a prism.
   */
  dispersion: number
  /** Jitters each sample along the split, so the fringe breaks up rather than banding. */
  lensNoise: number
  /**
   * A zoom made during the exposure: the frame smeared along rays from its
   * middle. Unlike anything in Focus, it acts on the whole picture rather than
   * on what happens to be out of focus.
   */
  radialBlur: number
  /** The same, turned rather than racked — a twist about the middle. */
  spinBlur: number

  // Grade
  emission: number
  exposure: number
  contrast: number
  saturation: number
  tonemap: boolean
  vignette: number
  grain: number
  attenuation: number
  background: string

  /** How far to push the picture onto the two-colour ramp below. */
  duotone: number
  duotoneShadow: string
  duotoneHighlight: string

  /**
   * Veiling glare: a floor under the bloom threshold, so every pixel diffuses a
   * little rather than only the ones bright enough to glow.
   */
  bleed: number

  // Stylize
  /** Which screen the finished frame is redrawn through, or `none`. */
  stylize: StylizeMode
  /** Cell size of that screen, in pixels of a 1080p frame. */
  stylizeScale: number
  /** Steps the colour is quantized to. */
  stylizeLevels: number
  /** 0 keeps only the brightness, 1 keeps the colour it came in with. */
  stylizeColour: number
  /** Screen angle, for the modes that have one. */
  stylizeAngle: number
  /**
   * Which part of the picture the screen is allowed to touch.
   *
   * Zero is the whole frame. Pushed positive it retreats to the highlights and
   * leaves everything below them as photographed; pulled negative it does the
   * opposite and keeps to the shadows.
   *
   * One signed control rather than a threshold and a direction, because the
   * two are never useful apart — and the middle of its travel is the answer
   * anyone reaching for it already had.
   */
  stylizeMask: number
  /** Which ramp of glyphs the ascii screen draws with. */
  asciiSet: AsciiSet

}

export const DEFAULT_SETTINGS: LabSettings = {
  stageWidth: 1100,
  stageHeight: 720,
  outputWidth: 1920,
  outputHeight: 1080,
  fps: 30,
  timelineLength: 6000,
  tail: 0,
  container: 'mp4',
  speed: 1,

  pitch: 0,
  yaw: 0,
  roll: 0,
  zoom: 1,
  fov: 32,
  panX: 0,
  panY: 0,

  focus: 0.5,
  focusRange: 0.35,
  aperture: 0,
  blurRadius: 12,
  bokehBlades: 0,
  bokehCatEye: 0,
  bokehSwirl: 0,
  bokehSqueeze: 0,
  focusTilt: 0,
  focusTiltAngle: 0,

  bloomIntensity: 0.35,
  bloomThreshold: 0.75,
  bloomRadius: 1,
  streaks: 0,
  ghosts: 0,
  diffusion: 0,
  starIntensity: 0,
  starPoints: 4,
  starAngle: 0,
  starLength: 0.5,

  distortion: 0,
  aberration: 0,
  dispersion: 0,
  lensNoise: 0,
  radialBlur: 0,
  spinBlur: 0,

  emission: 1,
  exposure: 1,
  contrast: 1,
  saturation: 1,
  tonemap: true,
  vignette: 0.35,
  grain: 0.015,
  attenuation: 0,
  background: '#000000',

  duotone: 0,
  // Only ever seen once `duotone` is dialled up, so these are the ramp somebody
  // arriving at the control should find already on it: a cold shadow and a warm
  // highlight, which is the split that reads as a duotone rather than as a tint.
  duotoneShadow: '#1a1b3a',
  duotoneHighlight: '#ffd9a8',

  bleed: 0,

  stylize: 'none',
  stylizeScale: 8,
  stylizeLevels: 4,
  stylizeColour: 0,
  stylizeAngle: 15,
  stylizeMask: 0,
  asciiSet: 'ascii',
}

/** Visual settings that a timeline clip can override for its own span. */
export const SHOT_SETTING_KEYS = [
  'pitch',
  'yaw',
  'roll',
  'zoom',
  'fov',
  'panX',
  'panY',
  'focus',
  'focusRange',
  'aperture',
  'blurRadius',
  'bokehBlades',
  'bokehCatEye',
  'bokehSwirl',
  'bokehSqueeze',
  'focusTilt',
  'focusTiltAngle',
  'emission',
  'bloomIntensity',
  'bloomThreshold',
  'bloomRadius',
  'bleed',
  'streaks',
  'ghosts',
  'diffusion',
  'starIntensity',
  'starPoints',
  'starAngle',
  'starLength',
  'distortion',
  'aberration',
  'dispersion',
  'lensNoise',
  'radialBlur',
  'spinBlur',
  'exposure',
  'contrast',
  'saturation',
  'attenuation',
  'vignette',
  'grain',
  'tonemap',
  'background',
  'duotone',
  'duotoneShadow',
  'duotoneHighlight',
  'stylize',
  'stylizeScale',
  'stylizeLevels',
  'stylizeColour',
  'stylizeAngle',
  'stylizeMask',
  'asciiSet',
] as const satisfies readonly (keyof LabSettings)[]

export type ShotSettingKey = typeof SHOT_SETTING_KEYS[number]
export type ShotSettings = Pick<LabSettings, ShotSettingKey>

/** Bounds and step for every numeric control, driving both the UI and URL clamping. */
/**
 * One line per control that cannot be understood from its name.
 *
 * Only where a label genuinely falls short — a hint on `Exposure` would be
 * noise, and a panel where everything is annotated reads as a panel where
 * nothing is worth reading.
 */
export const HINTS: Partial<Record<string, string>> = {
  zoom: 'Framing relative to fitting the scene edge to edge. 1 fits exactly.',
  fov: 'Lens angle. Wide exaggerates the tilt; narrow flattens it.',
  focus: 'Where the sharp band sits across the scene depth. 0 is the nearest edge, 1 the farthest.',
  focusRange: 'How thick the sharp band is. Small leaves only a slice in focus.',
  aperture: 'How strongly out-of-focus areas blur. Zero turns depth of field off.',
  blurRadius: 'Widest the bokeh can grow, measured on a 1080p frame.',
  bokehBlades: 'Sides of the aperture. Zero is a perfect disc; six is what an iris gives.',
  bokehCatEye: 'Squeezes the bokeh into a lens shape towards the corners, the way a barrel does.',
  bokehSwirl: 'Bends the bokeh into arcs that sweep around the frame — an uncorrected field.',
  bokehSqueeze: 'Stands the bokeh up into ovals, the way an anamorphic front element does.',
  focusTilt: 'Leans the sharp plane away from the sensor, so it cuts across the frame instead of facing it.',
  focusTiltAngle: 'Which way that lean runs.',
  streaks: 'Stretches the highlights sideways, the way an anamorphic lens flares.',
  ghosts: 'Reflections thrown back across the centre from whatever is bright.',
  diffusion: 'Scatters the light already there instead of adding more. Veils the blacks, lowers contrast.',
  starIntensity: 'Diffraction spikes off the highlights, the way an etched filter throws them.',
  emission: 'How bright the picture is before it glows. Raise it to give bloom something to catch; it is what feeds the glow, not the glow itself.',
  attenuation: 'Darkens the scene as it recedes, which reads as depth.',
  bloomThreshold: 'Brightness a pixel must reach before it glows.',
  bloomRadius: 'How far the glow spreads.',
  distortion: 'Bends the frame. Positive bulges it towards you, negative pinches it in.',
  aberration: 'Splits the colour channels towards the edges, the way a real lens does.',
  dispersion: 'Smears that split into a spectrum instead of three clean channels.',
  lensNoise: 'Breaks the split up, so it reads as scattered light rather than as a band.',
  radialBlur: 'Smears the frame along rays from the middle — a zoom made while the shutter was open.',
  spinBlur: 'Smears it along arcs instead — the same gesture, turned rather than racked.',
  duotone: 'Maps the picture onto two colours by brightness. The grade still applies on top.',
  bleed: 'Diffuses the whole picture, not only what is bright enough to glow. Halation.',
  stylizeScale: 'Cell size of the screen, measured on a 1080p frame.',
  stylizeLevels: 'Steps the brightness is quantized to before the screen draws it.',
  stylizeColour: 'Zero draws in brightness alone; one keeps the colour underneath.',
  stylizeMask: 'Confines the screen to the bright parts, or below zero to the dark ones. Zero is everywhere.',
  tail: 'Black held after the last clip ends, so a shot can land instead of cutting.',
  speed: 'Playback rate. Below 1 the animation is stepped in smaller increments — real slow motion.',
  lookAmount: 'How far towards the look to go. Past 1 it is pushed beyond what it was authored at.',
} as const

export const RANGES = {
  pitch: { min: -60, max: 60, step: 0.5, unit: '°' },
  yaw: { min: -60, max: 60, step: 0.5, unit: '°' },
  roll: { min: -180, max: 180, step: 0.5, unit: '°' },
  zoom: { min: 0.3, max: 4, step: 0.005 },
  fov: { min: 8, max: 90, step: 0.5, unit: '°' },
  panX: { min: -3, max: 3, step: 0.01 },
  panY: { min: -3, max: 3, step: 0.01 },

  focus: { min: 0, max: 1, step: 0.002 },
  focusRange: { min: 0.02, max: 1, step: 0.005 },
  aperture: { min: 0, max: 1.5, step: 0.005 },
  blurRadius: { min: 1, max: 90, step: 1, unit: 'px' },
  // Below three there is no polygon to draw, so the step from 0 lands straight
  // on a triangle and everything between is skipped rather than clamped.
  bokehBlades: { min: 0, max: 9, step: 1 },
  bokehCatEye: { min: 0, max: 1, step: 0.005 },
  bokehSwirl: { min: 0, max: 1, step: 0.005 },
  bokehSqueeze: { min: 0, max: 1.5, step: 0.005 },
  focusTilt: { min: -1, max: 1, step: 0.005 },
  focusTiltAngle: { min: 0, max: 180, step: 1, unit: '°' },

  bloomIntensity: { min: 0, max: 3, step: 0.005 },
  bloomThreshold: { min: 0, max: 2, step: 0.005 },
  bloomRadius: { min: 0.2, max: 4, step: 0.01 },
  streaks: { min: 0, max: 1.5, step: 0.005 },
  ghosts: { min: 0, max: 1.5, step: 0.005 },
  diffusion: { min: 0, max: 1, step: 0.005 },
  starIntensity: { min: 0, max: 2, step: 0.005 },
  starPoints: { min: 2, max: 8, step: 1 },
  starAngle: { min: 0, max: 180, step: 1, unit: '°' },
  starLength: { min: 0.1, max: 1.5, step: 0.005 },

  emission: { min: 0.2, max: 4, step: 0.005 },
  exposure: { min: 0.05, max: 4, step: 0.005 },
  contrast: { min: 0.5, max: 2, step: 0.005 },
  saturation: { min: 0, max: 2, step: 0.005 },
  // Past ±0.6 the corners fold back over themselves, which is a mirror rather
  // than a lens. The range stops where the map is still monotonic.
  distortion: { min: -0.6, max: 0.6, step: 0.005 },
  aberration: { min: 0, max: 3, step: 0.005 },
  dispersion: { min: 0, max: 1, step: 0.005 },
  lensNoise: { min: 0, max: 1, step: 0.005 },
  radialBlur: { min: 0, max: 1, step: 0.005 },
  spinBlur: { min: 0, max: 1, step: 0.005 },

  vignette: { min: 0, max: 1, step: 0.005 },
  grain: { min: 0, max: 0.12, step: 0.001 },
  attenuation: { min: 0, max: 1, step: 0.005 },

  duotone: { min: 0, max: 1, step: 0.005 },
  bleed: { min: 0, max: 1, step: 0.005 },

  // Authored against a 1080p frame and scaled to the real one, like `blurRadius`
  // — otherwise the cells would be a different size in the preview than in the
  // export, and would change every time the window was resized.
  stylizeScale: { min: 3, max: 48, step: 1, unit: 'px' },
  stylizeLevels: { min: 2, max: 16, step: 1 },
  stylizeColour: { min: 0, max: 1, step: 0.005 },
  stylizeAngle: { min: 0, max: 90, step: 1, unit: '°' },
  stylizeMask: { min: -1, max: 1, step: 0.005 },

  stageWidth: { min: 320, max: 2400, step: 10, unit: 'px' },
  stageHeight: { min: 240, max: 1600, step: 10, unit: 'px' },
  // Low minimums on purpose: clamping an output size silently changes the
  // aspect ratio of a shot, which is worse than allowing a small frame.
  outputWidth: { min: 240, max: 3840, step: 2, unit: 'px' },
  outputHeight: { min: 240, max: 2160, step: 2, unit: 'px' },
  tail: { min: 0, max: 10000, step: 50, unit: 'ms' },
  fps: { min: 12, max: 60, step: 1, unit: 'fps' },
  speed: { min: 0.1, max: 2, step: 0.05, unit: '×' },
} as const satisfies Record<string, { min: number, max: number, step: number, unit?: string }>

export type RangedKey = keyof typeof RANGES

/**
 * How densely the staged animation is rasterized.
 *
 * A constant rather than a control: two is sharp enough that text holds up at
 * 4K and cheap enough that capture stays interactive, and nobody shooting a
 * release video wants to be asked about supersampling first.
 */
export const PLATE_SCALE = 2

/**
 * Where the video is going, rather than what shape it is.
 *
 * A ratio is a fact about the frame; a destination is the reason you picked it.
 * "16:9" made you do the translation yourself every time — and the pixel count
 * still matters, so it is stated underneath instead of being the whole label.
 */
export const OUTPUT_PRESETS = [
  { id: 'post', label: 'X post', note: 'Landscape, the safe default', width: 1920, height: 1080 },
  { id: 'readme', label: 'README', note: 'Lighter file for a repo', width: 1600, height: 900 },
  { id: 'email', label: 'Email', note: 'Fits a newsletter column', width: 1200, height: 675 },
  { id: 'square', label: 'Square', note: 'Feeds that crop the sides', width: 1080, height: 1080 },
  { id: 'story', label: 'Shorts', note: 'Vertical, full screen', width: 1080, height: 1920 },
  { id: 'hero', label: 'Hero', note: 'Wide banner strip', width: 1920, height: 960 },
] as const

/**
 * Screens to lay the component out at.
 *
 * The viewport is the one setting here that changes what is being filmed rather
 * than how it is filmed — a component at 390 wide stacks what it lays side by
 * side at 1440 — so the presets are the widths that trip real breakpoints.
 */
export const VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { id: 'laptop', label: 'Laptop', width: 1100, height: 720 },
  { id: 'tablet', label: 'Tablet', width: 834, height: 1112 },
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
] as const

/**
 * The rates anyone actually delivers at.
 *
 * A slider invited you to land on 37fps, which is never what you meant.
 */
export const FRAME_RATES = [24, 30, 60] as const

/** Playback rates, as multiples of the animation's own speed. */
export const SPEEDS = [0.25, 0.5, 1, 2] as const

const BOOLEAN_KEYS = ['tonemap'] as const
const STRING_KEYS = [
  'background',
  'container',
  'duotoneShadow',
  'duotoneHighlight',
  'stylize',
  'asciiSet',
] as const

/**
 * String settings drawn from a closed set.
 *
 * `background` is free text and `look` is a name, but a screen mode is an index
 * into a shader's switch — a hand-edited URL holding `stylize=fisheye` would
 * otherwise select whatever that fell through to.
 */
const ENUM_KEYS: Partial<Record<keyof LabSettings, readonly string[]>> = {
  stylize: STYLIZE_MODES,
  asciiSet: ASCII_SETS,
}

function clampRanged(key: string, value: number): number {
  const range = (RANGES as Record<string, { min: number, max: number } | undefined>)[key]
  if (!range) return value
  return Math.min(range.max, Math.max(range.min, value))
}

/**
 * Clamp to a control's range and round to its step.
 *
 * Blending two looks lands between steps, and a slider handed 0.6173 shows one
 * number while holding another. Rounding at the source keeps every value in the
 * settings on the same grid the controls put them on.
 */
export function snapToRange(key: string, value: number): number {
  const range = (RANGES as Record<string, { min: number, max: number, step: number } | undefined>)[key]
  if (!range) return value

  const stepped = Math.round(value / range.step) * range.step
  const clamped = Math.min(range.max, Math.max(range.min, stepped))
  // The step is the precision: deriving it from the string avoids the float
  // noise that `0.1 * 3` style arithmetic leaves behind.
  const text = String(range.step)
  const dot = text.indexOf('.')
  return Number(clamped.toFixed(dot === -1 ? 0 : text.length - dot - 1))
}

/**
 * Serialize to a query string, omitting anything still at its default.
 *
 * Keeping defaults out is what makes a shared link readable: a shot that only
 * changed the tilt produces `?c=Foo&pitch=16`, not forty parameters.
 */
export function settingsToQuery(settings: LabSettings): Record<string, string> {
  const query: Record<string, string> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof LabSettings)[]) {
    const value = settings[key]
    if (value === DEFAULT_SETTINGS[key]) continue
    if (typeof value === 'number') query[key] = String(Number(value.toFixed(4)))
    else if (typeof value === 'boolean') query[key] = value ? '1' : '0'
    else if (value) query[key] = value
  }
  return query
}

function coerceSetting(key: keyof LabSettings, raw: unknown): string | number | boolean | undefined {
  if ((STRING_KEYS as readonly string[]).includes(key)) {
    if (typeof raw !== 'string') return undefined
    const allowed = ENUM_KEYS[key]
    return allowed && !allowed.includes(raw) ? undefined : raw
  }

  if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
    return typeof raw === 'boolean' ? raw : undefined
  }

  return typeof raw === 'number' && Number.isFinite(raw) ? clampRanged(key, raw) : undefined
}

/** Rebuild settings from a query, ignoring anything unrecognised or out of range. */
export function settingsFromQuery(query: Record<string, unknown>): LabSettings {
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof LabSettings)[]) {
    const raw = query[key]
    if (raw === undefined || raw === null || Array.isArray(raw)) continue
    const value = String(raw)
    const normalized = (BOOLEAN_KEYS as readonly string[]).includes(key)
      ? value === '1' || value === 'true'
      : (STRING_KEYS as readonly string[]).includes(key) ? value : Number(value)
    const coerced = coerceSetting(key, normalized)
    if (coerced !== undefined) Object.assign(settings, { [key]: coerced })
  }
  return settings
}

/** Coerce the sparse visual settings stored on a clip. */
export function sanitizeShotSettings(value: unknown): Partial<ShotSettings> {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const settings: Partial<ShotSettings> = {}

  for (const key of SHOT_SETTING_KEYS) {
    const raw = record[key]
    const coerced = coerceSetting(key, raw)
    if (coerced !== undefined) Object.assign(settings, { [key]: coerced })
  }

  return settings
}

/**
 * Output length in milliseconds.
 *
 * Derived rather than set. The timeline runs as long as its content and the
 * export covers all of it, so there is nothing to keep in agreement — an
 * in-point that could outlive the clips left the playhead past every layer's
 * span, and the frame simply went black.
 */
export function outputDuration(settings: LabSettings): number {
  return Math.max(0, settings.timelineLength / Math.max(settings.speed, 0.01))
}

/**
 * Component milliseconds one output frame covers.
 *
 * Every path that moves time — playback, scrubbing, export — steps by this, so
 * they all land on the same instants. Advancing at display rate in the preview
 * and at the frame rate in the export would put CSS transitions at different
 * phases, and the frame that was graded would not be the frame that renders.
 */
export function frameStep(settings: LabSettings): number {
  return (1000 / Math.max(settings.fps, 1)) * settings.speed
}

/** Frames the current segment will produce. */
export function frameCountFor(settings: LabSettings): number {
  return Math.max(1, Math.round((outputDuration(settings) / 1000) * settings.fps))
}

/**
 * Softness of the bloom threshold, derived rather than dialled.
 *
 * The prefilter's knee reaches *down* from the threshold, so a knee wider than
 * the threshold hands a bloom multiplier to near-black pixels: at 0.5 against a
 * 0.25 threshold the backdrop picked up a 3.4× gain and the frame came out a
 * grey slab. As a control it had one correct answer and a range full of wrong
 * ones, which is not a control — it is a trap with a slider on it.
 */
export function bloomKneeFor(threshold: number): number {
  return Math.min(0.35, Math.max(0.02, threshold * 0.5))
}

/**
 * Taps per pixel in the bokeh, derived from how wide it is allowed to grow.
 *
 * A quality dial rather than a look dial: there is no radius at which fewer taps
 * is the better picture, only one past which more of them stop being visible. So
 * it follows the radius — a 90px disc no longer has to be gathered at the same
 * 32 taps that were plenty for a 12px one, which is what left wide apertures
 * banded into rings.
 */
export function dofSamplesFor(blurRadius: number): number {
  return Math.min(96, Math.round(24 + blurRadius * 0.8))
}

export function hexToLinearRgb(hex: string): [number, number, number] {
  const match = /^#?([\da-f]{6})$/i.exec(hex.trim())
  if (!match?.[1]) return [0, 0, 0]
  const int = Number.parseInt(match[1], 16)
  const srgb = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map(c => c / 255)
  return srgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
}
