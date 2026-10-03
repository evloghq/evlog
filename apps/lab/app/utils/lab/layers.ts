/**
 * Overlay layers: what gets composed on top of the staged component.
 *
 * They live inside the stage rather than over the finished frame, so a title or
 * a logo goes through the same camera the component does — it sits on the tilted
 * plane, catches the same bokeh and the same bloom. An overlay composited after
 * the render would sit flat on the glass and read as a caption stuck to the
 * screen rather than as part of the shot.
 *
 * Each layer owns a span of the timeline. Outside it the layer is simply not
 * there, and the fades at either end are what makes an entrance rather than a
 * hard cut.
 */

import { evaluateEffects, sanitizeEffects } from './effects'
import type { EffectResult, LayerEffect } from './effects'
import { SHOT_SETTING_KEYS, sanitizeShotSettings } from './settings'
import type { ShotSettings } from './settings'

export type LayerKind = 'text' | 'image' | 'video' | 'component'

/**
 * Where a layer lives.
 *
 * `plate` pins it to the staged animation's own surface, so a caption sits on
 * the panel and takes its tilt. `scene` floats it in front or behind at its own
 * depth. `overlay` skips the camera entirely and draws flat on the finished
 * frame — a watermark or a lower third that should stay sharp and square no
 * matter how the shot is angled.
 */
export type LayerSpace = 'plate' | 'scene' | 'overlay'

export interface LayerShot {
  /** Sparse visual overrides; absent values continue to follow the timeline shot. */
  settings?: Partial<ShotSettings>
  /** Camera moves local to this clip. Absent inherits the timeline moves. */
  camera?: LayerEffect[]
}

export interface Layer {
  id: string
  kind: LayerKind
  name: string
  /** Span on the component timeline, in ms. */
  start: number
  duration: number
  /** Entrance and exit effects, evaluated against the clip's local time. */
  effects: LayerEffect[]

  /** Placement as a fraction of the stage, so it survives a stage resize. */
  x: number
  y: number
  /**
   * Distance from the component's plane, in world units.
   *
   * Negative floats the layer towards the camera, positive pushes it behind.
   * A layer at zero sits exactly on the plate — which is where an overlay
   * composited into the stage was stuck, sharing the component's tilt, focus
   * and parallax whether that was wanted or not.
   */
  depth: number
  space?: LayerSpace
  /** Width as a fraction of the stage; height follows the content. */
  width: number
  rotation: number
  opacity: number
  /**
   * Taken out of the picture without being taken out of the document.
   *
   * Distinct from an opacity of zero, and the difference is what makes it
   * useful: hiding is a thing you do to look at what is underneath, and it has
   * to be undoable without remembering what the opacity used to be.
   */
  hidden?: boolean

  // Text
  text?: string
  /** Font size as a fraction of stage height, so type scales with the stage. */
  fontSize?: number
  color?: string
  weight?: number
  font?: LayerFont
  align?: 'left' | 'center' | 'right'
  /** Line box as a multiple of the size — the one control that sets a block's texture. */
  lineHeight?: number
  /** Tracking, in ems. Negative tightens, which is what large type usually wants. */
  letterSpacing?: number
  italic?: boolean
  uppercase?: boolean
  /** A rule through or under the words, drawn from the font's own metrics. */
  decoration?: 'none' | 'underline' | 'strikethrough'
  /**
   * A cast shadow, which `glow` cannot be.
   *
   * Glow is centred on the glyphs by construction — it is a halo. An offset one
   * is what lifts type off a busy plate, and the two are worth having at once.
   */
  shadow?: number
  shadowX?: number
  shadowY?: number
  shadowColor?: string
  /**
   * Whether the box follows the type or the type wraps into the box.
   *
   * `auto` hugs: the texture is exactly as wide as the longest line, and a
   * corner drag scales the type. `fixed` is a column: the width is set and the
   * text wraps into it, which is what a paragraph wants and what a caption
   * never did.
   *
   * Absent means auto. A caption is what this is nearly always used for and a
   * paragraph is the exception, so the exception is the one that says so.
   */
  textFit?: 'auto' | 'fixed'
  /**
   * Halo around the glyphs, as a fraction of the size, in the text's own colour.
   *
   * The docs theme leans on glow, so a title that carries some belongs to the
   * same world as the animation behind it. It is drawn into the texture rather
   * than left to the bloom pass: bloom reacts to brightness across the whole
   * frame, which cannot be aimed at one title without dragging everything else
   * up with it.
   */
  glow?: number
  /** Outline width as a fraction of the size — legibility over a busy plate. */
  stroke?: number
  strokeColor?: string

  /** Registry name of the staged animation, for `component` layers. */
  component?: string

  // Image and video
  /**
   * `asset:<hash>`, resolved against the stored blob when the layer is drawn.
   *
   * Media used to be inlined here as a data URL, which made a document
   * self-contained and made it enormous. The bytes moved to IndexedDB; this is a
   * reference to them, so a document stays small enough for local storage, for
   * an undo snapshot and for a link.
   *
   * A data URL still resolves, untouched, because documents saved before the
   * move carry one and there is no reason to make them stop opening.
   */
  src?: string
  /** Where in the source clip the layer starts, in ms. */
  trim?: number
  /** Source playback rate for video and staged component layers. */
  speed?: number
  /** Shot overrides active while this clip is on the timeline. */
  shot?: LayerShot
}

export const MIN_LAYER_SPEED = 0.25
export const MAX_LAYER_SPEED = 4

let counter = 0

function nextId(): string {
  counter += 1
  return `layer-${Date.now().toString(36)}-${counter}`
}

export function createTextLayer(start: number, duration: number): Layer {
  return {
    id: nextId(),
    kind: 'text',
    name: 'Text',
    start,
    duration,
    // No animation by default. Media should appear exactly as authored; motion
    // is something you add deliberately, not something to notice and undo.
    effects: [],
    x: 0.5,
    y: 0.5,
    depth: -0.35,
    space: 'scene',
    width: 0.6,
    rotation: 0,
    opacity: 1,
    text: 'evlog',
    fontSize: 0.12,
    color: '#ffffff',
    weight: 500,
    font: 'pixel',
    align: 'center',
  }
}

export interface MediaLayerInit {
  kind: 'image' | 'video'
  start: number
  duration: number
  /** `asset:<hash>` reference to the stored bytes. */
  src: string
  name: string
}

export function createMediaLayer({ kind, start, duration, src, name }: MediaLayerInit): Layer {
  return {
    id: nextId(),
    kind,
    name,
    start,
    duration,
    effects: [],
    x: 0.5,
    y: 0.5,
    depth: -0.35,
    space: 'scene',
    width: kind === 'video' ? 0.6 : 0.3,
    rotation: 0,
    opacity: 1,
    src,
    trim: 0,
  }
}

/** Video frames change with the playhead; everything else is drawn once. */
export function isTimeVarying(layer: Layer): boolean {
  return layer.kind === 'video'
}

/**
 * A built-in animation, staged as a layer like anything else.
 *
 * It used to be the one plane the renderer treated specially — it painted the
 * background and owned the whole timeline. As a layer it gets everything the
 * others already had: a right-click menu, effects, a depth, a span it can be
 * trimmed to, and the option of not being there at all.
 */
export function createComponentLayer(component: string, start: number, duration: number): Layer {
  return {
    id: nextId(),
    kind: 'component',
    name: component,
    start,
    duration,
    effects: [],
    x: 0.5,
    y: 0.5,
    depth: 0,
    space: 'scene',
    width: 1,
    rotation: 0,
    opacity: 1,
    component,
  }
}

/** A copy with a fresh identity, so duplicating never aliases the original. */
export function cloneLayer(layer: Layer, nameSuffix = ' copy'): Layer {
  return { ...layer, id: nextId(), name: `${layer.name}${nameSuffix}` }
}

/** `plate` layers ride on the animation's surface, so their depth is not theirs. */
export function layerDepth(layer: Layer): number {
  return layer.space === 'plate' ? 0 : layer.depth
}

export function layerEnd(layer: Layer): number {
  return layer.start + layer.duration
}

/** Whether this layer has a time-based source whose playback rate can change. */
export function canChangeLayerSpeed(layer: Layer): boolean {
  return layer.kind === 'video' || layer.kind === 'component'
}

/** Playback rate for a time-based clip. */
export function layerSpeed(layer: Layer): number {
  return canChangeLayerSpeed(layer) ? (layer.speed ?? 1) : 1
}

/** Position in a media source at a point on the timeline, in ms. */
export function layerSourceTimeAt(layer: Layer, time: number): number {
  return (layer.trim ?? 0) + (time - layer.start) * layerSpeed(layer)
}

/** Timeline span left before a source reaches its declared end, in ms. */
export function layerDurationForSourceEnd(layer: Layer, sourceEnd: number): number {
  return Math.max(100, Math.round((sourceEnd - (layer.trim ?? 0)) / layerSpeed(layer)))
}

/** Change playback rate without moving the source out-point. */
export function withLayerSpeed(layer: Layer, speed: number): Layer {
  if (!canChangeLayerSpeed(layer)) return layer
  const nextSpeed = Math.min(MAX_LAYER_SPEED, Math.max(MIN_LAYER_SPEED, speed))
  const duration = Math.max(100, Math.round((layer.duration * layerSpeed(layer)) / nextSpeed))
  return { ...layer, duration, speed: nextSpeed === 1 ? undefined : nextSpeed }
}

/**
 * The instant the clip's source is at its own zero.
 *
 * A clip trimmed by 1.5s and placed at 4s is showing a source that began at
 * 2.5s. For a staged component that is not a lookup — the animation has to have
 * been running since then — so this is the moment its instance is mounted, and
 * everything it does afterwards falls out of the clock on its own.
 *
 * It sits before the clip when trimmed, and can land before zero, which is
 * exactly the case of a cut whose tail was dragged back to the top.
 */
export function layerOrigin(layer: Layer): number {
  return layer.start - (layer.trim ?? 0) / layerSpeed(layer)
}

/**
 * Can these two be put back into one clip?
 *
 * A split is reversible in every editor worth using, because cutting is how you
 * find out where the cut should have been. Rejoining is only offered where it is
 * honest: the same source, meeting end to end, and continuous through the seam.
 * Fusing two clips that merely touch would silently drop whatever sits between
 * the first one's out point and the second one's in.
 */
const JOIN_TOLERANCE = 60

export function canJoin(a: Layer, b: Layer): boolean {
  if (a.kind !== b.kind) return false
  if (a.component !== b.component || a.src !== b.src) return false
  if (layerSpeed(a) !== layerSpeed(b)) return false
  if (!sameShot(a.shot, b.shot)) return false
  if (Math.abs(layerEnd(a) - b.start) > JOIN_TOLERANCE) return false
  return Math.abs((b.trim ?? 0) - ((a.trim ?? 0) + a.duration * layerSpeed(a))) <= JOIN_TOLERANCE
}

function sameShot(a: LayerShot | undefined, b: LayerShot | undefined): boolean {
  if (a?.camera === undefined || b?.camera === undefined) {
    if (a?.camera !== b?.camera) return false
  } else if (JSON.stringify(a.camera) !== JSON.stringify(b.camera)) {
    return false
  }
  return SHOT_SETTING_KEYS.every(key => a?.settings?.[key] === b?.settings?.[key])
}

/**
 * Where a layer is, and how visible, at a given instant.
 *
 * Returns null outside the clip's span so the renderer can skip it entirely
 * rather than issue a draw call for something nobody can see.
 */
/**
 * Where a layer is when nothing is animating it.
 *
 * A shot has no timeline, so a layer has no span to be inside or outside of and
 * no ramp to be part-way through — it is simply there, at the placement it was
 * given. Entrances and exits are kept on the layer rather than stripped, so a
 * document carried into a video still has them; they just describe nothing a
 * single frame can show.
 */
export function layerAtRest(layer: Layer): EffectResult | null {
  if (layer.hidden) return null
  const opacity = Math.max(0, Math.min(1, layer.opacity))
  if (opacity <= 0.001) return null
  return { opacity, offsetX: 0, offsetY: 0, depth: 0, scale: 1, rotation: 0 }
}

export function layerStateAt(layer: Layer, time: number): EffectResult | null {
  if (layer.hidden) return null
  if (time < layer.start || time > layerEnd(layer)) return null

  const effects = evaluateEffects(layer.effects, time - layer.start, layer.duration)
  const opacity = Math.max(0, Math.min(1, layer.opacity * effects.opacity))
  if (opacity <= 0.001) return null

  return { ...effects, opacity }
}

/**
 * The typefaces a text layer can be set in.
 *
 * Every one is declared in `nuxt.config` and downloaded by `@nuxt/fonts`, which
 * serves the files from this origin under `/_fonts/`. That detail is the whole
 * reason a face can be offered at all: the plate is rasterized through a sealed
 * SVG that resolves nothing, so `dom-texture` inlines each `@font-face` as a
 * data URI — and it can only do that for a file it is allowed to read. A face
 * loaded from a third-party CDN would look right in the panel and come out of
 * the render in the fallback.
 *
 * The variable is its own name rather than the source's `--font-sans`, so
 * adding a face here cannot change what the staged component is drawn in.
 */
export const FONT_CATALOGUE = [
  { value: 'pixel', label: 'Geist Pixel', variable: '--font-pixel', fallback: 'monospace' },
  { value: 'sans', label: 'Geist', variable: '--font-sans', fallback: 'sans-serif' },
  { value: 'mono', label: 'Geist Mono', variable: '--font-mono', fallback: 'monospace' },
  { value: 'inter', label: 'Inter', variable: '--lab-font-inter', fallback: 'sans-serif' },
  { value: 'grotesk', label: 'Space Grotesk', variable: '--lab-font-grotesk', fallback: 'sans-serif' },
  { value: 'bricolage', label: 'Bricolage', variable: '--lab-font-bricolage', fallback: 'sans-serif' },
  { value: 'archivo', label: 'Archivo', variable: '--lab-font-archivo', fallback: 'sans-serif' },
  { value: 'serif', label: 'Instrument', variable: '--lab-font-serif', fallback: 'serif' },
  { value: 'playfair', label: 'Playfair', variable: '--lab-font-playfair', fallback: 'serif' },
  { value: 'jetbrains', label: 'JetBrains', variable: '--lab-font-jetbrains', fallback: 'monospace' },
] as const

export type LayerFont = typeof FONT_CATALOGUE[number]['value']

const FONT_STACK = Object.fromEntries(
  FONT_CATALOGUE.map(font => [font.value, `var(${font.variable}, ${font.fallback})`]),
) as Record<LayerFont, string>

/** Font family for a layer, resolved against the fonts the app already loads. */
export function layerFontFamily(layer: Layer): string {
  // A face dropped from the catalogue leaves documents pointing at a name that
  // no longer resolves, and a text layer that renders as nothing reads as lost
  // rather than as restyled.
  return FONT_STACK[layer.font ?? 'pixel'] ?? FONT_STACK.pixel
}

/**
 * What the texture for a layer depends on.
 *
 * Anything not in this key can change without redrawing the layer — which is
 * the point: opacity and placement became uniforms, so a fade or a move costs
 * nothing but a draw call. Baking opacity into the texture is what made a
 * fading title re-rasterize on every frame.
 */
export function layerTextureKey(layer: Layer, stage: { width: number, height: number }, scale: number): string {
  if (layer.kind === 'component') return `${layer.id}|${layer.component}`
  // The whole source, not its length. Length was a stand-in from when a `src`
  // was a data URL megabytes long, and it was already wrong for two files that
  // happened to weigh the same. An asset reference is a fixed 38 characters, so
  // length had stopped telling any two of them apart at all.
  if (layer.kind !== 'text') return `${layer.id}|${layer.src ?? ''}`
  return [
    layer.id,
    layer.text,
    layer.fontSize,
    layer.color,
    layer.weight,
    layer.font,
    layer.align,
    layer.width,
    layer.lineHeight,
    layer.letterSpacing,
    layer.italic,
    layer.uppercase,
    layer.textFit,
    layer.decoration,
    layer.shadow,
    layer.shadowX,
    layer.shadowY,
    layer.shadowColor,
    layer.glow,
    layer.stroke,
    layer.strokeColor,
    Math.round(stage.width),
    Math.round(stage.height),
    scale,
  ].join('|')
}

/** Clamp a layer's span into the timeline, preserving its length where possible. */
export function constrainToTimeline(layer: Layer, timelineLength: number): Layer {
  const duration = Math.max(100, Math.min(layer.duration, timelineLength))
  const start = Math.max(0, Math.min(layer.start, timelineLength - duration))
  return { ...layer, start, duration }
}

/** Drop anything that is not a layer we can render, so bad storage cannot break the page. */
export function sanitizeLayers(value: unknown): Layer[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is Layer =>
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as Layer).id === 'string'
      && ['text', 'image', 'video', 'component'].includes((entry as Layer).kind),
    )
    .map((layer) => {
      const legacy = layer as Layer & { fadeIn?: number, fadeOut?: number }
      // Documents written before the effect library stored two bare fade
      // durations; carry them over rather than dropping somebody's shot.
      const migrated: LayerEffect[] = []
      if (!layer.effects && legacy.fadeIn) {
        migrated.push({ kind: 'fade', at: 'in', duration: legacy.fadeIn, easing: 'out', amount: 0 })
      }
      if (!layer.effects && legacy.fadeOut) {
        migrated.push({ kind: 'fade', at: 'out', duration: legacy.fadeOut, easing: 'inOut', amount: 0 })
      }

      return {
        ...layer,
        effects: layer.effects ? sanitizeEffects(layer.effects) : migrated,
        depth: Number.isFinite(layer.depth) ? layer.depth : 0,
        space: ['plate', 'scene', 'overlay'].includes(layer.space ?? '') ? layer.space : 'scene',
        hidden: layer.hidden === true,
        start: Number.isFinite(layer.start) ? Math.max(0, layer.start) : 0,
        duration: Number.isFinite(layer.duration) ? Math.max(100, layer.duration) : 1000,
        speed: canChangeLayerSpeed(layer) && Number.isFinite(layer.speed)
          ? Math.min(MAX_LAYER_SPEED, Math.max(MIN_LAYER_SPEED, layer.speed ?? 1))
          : undefined,
        shot: sanitizeLayerShot(layer.shot),
      }
    })
}

function sanitizeLayerShot(value: unknown): LayerShot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const settings = sanitizeShotSettings(record.settings)
  const hasCamera = Array.isArray(record.camera)
  if (!Object.keys(settings).length && !hasCamera) return undefined

  return {
    ...(Object.keys(settings).length ? { settings } : {}),
    ...(hasCamera ? { camera: sanitizeEffects(record.camera) } : {}),
  }
}
