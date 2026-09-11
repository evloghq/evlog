<script setup lang="ts">
/**
 * Render labs.
 *
 * A live doc component is staged off to the side, serialized into a texture
 * every frame, and put through a small camera-and-lens pipeline: tilt, depth of
 * field, bloom, grade. The result comes out as a still or a take at any
 * resolution — the pipeline is the same either way, and a single frame is just
 * a take one frame long.
 *
 * Its own app rather than a docs route: none of this ships to readers, and the
 * pipeline has nothing in common with a documentation site. The components it
 * stages do still come from the docs app, which is the point — a shot is taken
 * from the real component, not from a copy that has drifted.
 */

import { useResizable } from '~/composables/useResizable'
import { glyphAtlas } from '~/utils/lab/ascii'
import type { GlyphAtlas } from '~/utils/lab/ascii'
import { createClock } from '~/utils/lab/clock'
import { createDomTexture, invalidateStyles } from '~/utils/lab/dom-texture'
import type { PlateMarkup } from '~/utils/lab/dom-texture'
import { LabRenderer } from '~/utils/lab/renderer'
import { canvasToBlob, download, encodeVideo, isEncodingSupported, takeName } from '~/utils/lab/record'
import type { Container } from '~/utils/lab/record'
import { DEFAULT_COMPONENT, resolveEntry } from '~/utils/lab/registry'
import { DEFAULT_SETTINGS, PLATE_SCALE, SHOT_SETTING_KEYS, frameCountFor, frameStep, outputDuration } from '~/utils/lab/settings'
import type { LabSettings, ShotSettingKey, ShotSettings } from '~/utils/lab/settings'
import { useSequenceDurations } from '~/utils/lab/sequence'
import { MAX_SHARE_URL, createDocument, resolveInitialDocument, saveStored, shareUrl } from '~/utils/lab/storage'
import type { LabDocument, LabMode } from '~/utils/lab/storage'
import type { LayerGrab } from '~/composables/useLayerGestures'
import {
  cloneLayer,
  constrainToTimeline,
  createComponentLayer,
  createMediaLayer,
  isTimeVarying,
  createTextLayer,
  layerDepth,
  layerAtRest,
  layerStateAt,
  layerTextureKey, layerDurationForSourceEnd, layerEnd, layerOrigin, layerSourceTimeAt, layerSpeed, canJoin
} from '~/utils/lab/layers'
import type { Layer } from '~/utils/lab/layers'
import { hasLayerShot, resolveLayerShotSettings, resolveTimelineShot, withoutLayerShotSetting } from '~/utils/lab/shot'
import { evaluateEffects } from '~/utils/lab/effects'
import { getVideo, rasterizeLayer, seekVideo } from '~/utils/lab/layer-textures'
import type { LayerPlane, OverlayQuad } from '~/utils/lab/renderer'
import { isAssetRef, putAsset } from '~/utils/lab/assets'
import { persist, storageEstimate } from '~/utils/lab/db'
import {
  deleteProject,
  duplicateProject,
  exportProject,
  importProject,
  listProjects,
  openProject,
  projectFilename,
  renameProject,
  saveProject,
  sweepAssets,
} from '~/utils/lab/projects'
import type { ProjectSummary } from '~/utils/lab/projects'

// No head here on purpose. `ssr: false` means this component never runs during
// prerender, so anything set from the page is invisible to crawlers and
// unfurlers. The whole head lives in `nuxt.config.ts`, which does get rendered
// into the shell.

const route = useRoute()
const router = useRouter()

// A link wins over the stored working copy. With neither, there is nothing to
// resume and the launcher asks what to make rather than guessing.
const initial = resolveInitialDocument(route.query)
const blank = createDocument('shot')
const mode = ref<LabMode>(initial?.mode ?? blank.mode)
/** True until a document exists — the launcher covers the frame while it is. */
const launching = ref(!initial)
const settings = ref((initial ?? blank).settings)
const layers = ref<Layer[]>((initial ?? blank).layers)
const selectedId = ref<string | null>(null)
/** Camera moves over the take. */
const camera = ref((initial ?? blank).camera)

/** A shot is one frame, so nothing in it is ever part-way through an entrance. */
const stateOf = (layer: Layer) => (
  mode.value === 'shot' ? layerAtRest(layer) : layerStateAt(layer, playhead.value)
)
/**
 * Clips whose length is still a guess, waiting on the animation to state its own.
 *
 * A component cannot be asked how long it runs before it exists: the number
 * arrives from its sequencer during the first mount, a tick after the clip does.
 * So a new clip is marked here, cut to length when the report lands, and dropped
 * from the set — a clip trimmed later is nobody's business but the editor's.
 *
 * Deliberately not reactive. It is a note about intent, not part of the document.
 */
const awaitingFit = new Set<string>()

// An opened document that came in empty gets the built-in animation, because a
// blank frame is the one state this tool cannot show you anything with.
//
// Never while the launcher is up: seeding there would write a document nobody
// asked for, and the next reload would find it and skip the question entirely —
// which is the exact behaviour the launcher exists to end.
if (!launching.value && !layers.value.length) {
  const first = createComponentLayer(DEFAULT_COMPONENT, 0, settings.value.timelineLength)
  awaitingFit.add(first.id)
  layers.value = [first]
  // Written straight away rather than waiting for the first edit, so a reload
  // resumes the same document instead of seeding a second one.
  saveStored(currentDocument())
}

// Having adopted the link, drop its query. The address bar then only ever holds
// a URL somebody deliberately produced, and never a running log of every slider
// that happened to be touched.
if (initial?.fromLink) router.replace({ query: {} })

const panelVisible = ref(true)
const shortcutsOpen = ref(false)

/** Composition overlay — thirds, safe area, rulers. Never filmed. */
const guides = ref(false)
/** The axis gizmo, off by default: it is a readout, not part of the picture. */
const gizmo = ref(false)

/**
 * Put the camera square onto an axis.
 *
 * Roll goes to zero alongside, because "look down X" means a level shot down X
 * — leaving a tilt on would land you square to the plate and still crooked,
 * which is not what anyone clicking an axis is asking for.
 */
function snapCamera(pitch: number, yaw: number) {
  editorShotSettings.value = { ...editorShotSettings.value, pitch, yaw, roll: 0 }
  cue('toggle')
}
/** Pointer over the frame, 0..1, for the crosshair readout. */
const framePointer = ref<{ x: number, y: number } | null>(null)

/** Where a pointer event sits on the frame, as a fraction with y down. */
function framePointAt(event: PointerEvent, element: HTMLElement): { x: number, y: number } {
  const box = element.getBoundingClientRect()
  return {
    x: (event.clientX - box.left) / box.width,
    y: (event.clientY - box.top) / box.height,
  }
}

function onFramePointer(event: PointerEvent) {
  const element = event.currentTarget as HTMLElement
  // Dragging a layer needs this on every move; the reticle needs it only while
  // it is up. Outside both, recomputing a rectangle for every pointer move over
  // the frame is a cost with nothing to show for it.
  if (layerGestures.active.value) {
    layerGestures.move(framePointAt(event, element))
    return
  }
  if (!picking.value) {
    framePointer.value = null
    return
  }
  framePointer.value = framePointAt(event, element)
}
const timeline = useTemplateRef('timeline')
/** Armed by the crosshair button; the next click on the frame sets the focal plane. */
const picking = ref(false)

const canvas = useTemplateRef('canvas')
/** The frame box, which is the coordinate space every layer gesture works in. */
const frame = useTemplateRef('frame')
const stagesRoot = useTemplateRef('stagesRoot')

// Only to put the theme on the chrome; nothing here reads it.
const { isDark } = useLabTheme()

/**
 * The chrome, which is the only part of this page that is an interface.
 *
 * The delegated sound listeners are attached here rather than to the document
 * so the stage — a live subtree being rasterized every frame — is never in
 * scope. Nothing being filmed should be able to make a noise.
 */
const chrome = useTemplateRef('chrome')
const { enabled: cuesEnabled, install: installCues, setCuesEnabled, cue } = useCues()

/** Bumped to remount every staged component, restarting their sequences at zero. */
const stageKey = ref(0)

const componentLayers = computed(() => layers.value.filter(layer => layer.kind === 'component'))
const stagedComponents = computed(() =>
  componentLayers.value.map(layer => ({ layer, component: resolveEntry(layer.component ?? '') })),
)

/** Position on the component's own timeline, in ms. */
const playhead = ref(0)
/**
 * Opens paused, on the first frame.
 *
 * Arriving to something already in motion means the first thing you do is stop
 * it — and if the take is short you have missed it before you found the button.
 * The playhead is a tool, not a demo reel: it moves when asked.
 */
const playing = ref(false)
const seeking = ref(false)

const busy = ref(false)
const progress = ref(0)
const highPrecision = ref(true)
const captureMs = ref(0)
const error = ref('')

let renderer: LabRenderer | null = null
/** One serializer per staged component: each keeps its own unchanged-markup check. */
const stageTextures = new Map<string, ReturnType<typeof createDomTexture>>()
let clock: ReturnType<typeof createClock> | null = null
let rafHandle = 0
let observer: ResizeObserver | null = null
let capturing = false
let lastCaptureAt = 0
let lastFrameAt = 0
/** Component time owed to the clock but not yet worth a whole frame. */
let frameDebt = 0
let videoSyncing = false

/**
 * Preview resolution, matched to how large the canvas is actually drawn.
 *
 * A fixed backing size stretched to fill the viewport is the whole reason a
 * preview looks soft and blocky: the browser upscales it, and on a high-density
 * display that is a 2× or 3× magnification of an already-too-small buffer. So
 * the buffer follows the element's real size times the device pixel ratio.
 *
 * The ceiling exists because everything downstream is per-pixel: a 64-tap bokeh
 * over a 5K buffer would turn slider dragging into a slideshow. Beyond it the
 * preview goes back to being upscaled, which is the right trade at that size.
 */
const PREVIEW_MAX_PIXELS = 2560 * 1440
const displaySize = ref({ width: 0, height: 0 })

const previewSize = computed(() => {
  const { outputWidth, outputHeight } = settings.value
  const { width: cssWidth } = displaySize.value

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  // Never exceed the export resolution — past it there is no more detail to show.
  let width = cssWidth > 0 ? Math.min(outputWidth, Math.round(cssWidth * dpr)) : outputWidth
  let height = Math.round((width * outputHeight) / outputWidth)

  const excess = (width * height) / PREVIEW_MAX_PIXELS
  if (excess > 1) {
    const shrink = Math.sqrt(excess)
    width = Math.round(width / shrink)
    height = Math.round(height / shrink)
  }

  return {
    // Even dimensions keep the preview consistent with what the encoder accepts.
    width: Math.max(2, Math.round(width / 2) * 2),
    height: Math.max(2, Math.round(height / 2) * 2),
  }
})

/**
 * The camera as it stands at the playhead.
 *
 * A travelling is the effect library pointed at the shot instead of a layer: a
 * dolly moves the camera along its own axis, a slide pans it, a spin rolls it,
 * and a fade takes the whole frame down to black through exposure. Same ramps,
 * same curves, same editor.
 */
const resolvedShot = computed(() => resolveTimelineShot(
  settings.value,
  camera.value,
  mode.value === 'video' ? layers.value : [],
  playhead.value,
))

const shotSettings = computed(() => {
  const shot = resolvedShot.value
  if (!shot.camera.length) return shot.settings
  const move = evaluateEffects(shot.camera, shot.cameraTime, shot.cameraDuration)
  return {
    ...shot.settings,
    // Depth reads as distance: still displaced means still pulled back, so the
    // move resolves into the framing rather than out of it.
    zoom: Math.max(0.05, (shot.settings.zoom * move.scale) / (1 + move.depth)),
    panX: shot.settings.panX + move.offsetX,
    panY: shot.settings.panY + move.offsetY,
    roll: shot.settings.roll + move.rotation,
    exposure: shot.settings.exposure * move.opacity,
  }
})

/**
 * The timeline is as long as what is on it.
 *
 * Set by hand it could outlive every clip, and the playhead would sit past all
 * of them on a frame where nothing is in its span — a black frame, in the
 * preview and in the export alike.
 */
watch([layers, () => settings.value.tail], () => {
  const end = layers.value.reduce((longest, layer) => Math.max(longest, layerEnd(layer)), 0)
  settings.value.timelineLength = Math.max(1000, Math.round(end) + settings.value.tail)
}, { deep: true, immediate: true })

const stageAspect = computed(() => settings.value.stageWidth / settings.value.stageHeight)
function currentDocument() {
  return { mode: mode.value, settings: settings.value, layers: layers.value, camera: camera.value }
}

/**
 * Undo over the same document that is saved and shared.
 *
 * Seeded after the opening layer is placed, so the first undo of a fresh session
 * reverses an edit rather than emptying the frame back to a state nobody was
 * ever shown.
 */
const { undo, redo, canUndo, canRedo } = useLabHistory(currentDocument, (state) => {
  mode.value = state.mode
  settings.value = state.settings
  layers.value = state.layers
  camera.value = state.camera
  // A layer that only exists in the future is not something to keep selected;
  // the panel would hold a tab for a clip the timeline no longer draws.
  if (selectedId.value && !state.layers.some(layer => layer.id === selectedId.value)) selectedId.value = null
  // The scene is still wherever the undone edit left it. `originSignature`
  // catches a clip that moved, but not a look, a viewport or a text layer's
  // wording — so replay unconditionally and let the frame match the document.
  void seekTo(playhead.value)
})

/** What a take is named after: the first thing in it that has a name. */
const takeSubject = computed(() => layers.value[0]?.name ?? 'lab')
const outputMs = computed(() => outputDuration(settings.value))
const frameCount = computed(() => frameCountFor(settings.value))

/**
 * Serialize every staged component into its texture.
 *
 * Each has its own serializer so its unchanged-markup check is its own: a title
 * card that is holding still must not be re-rasterized because a chart beside it
 * moved.
 */
async function captureStage(): Promise<void> {
  if (!renderer || !stagesRoot.value) return
  // The virtual clock owns `performance.now`, so timing has to come from the
  // real one — otherwise every capture measures as taking zero time.
  const started = Date.now()
  const { stageWidth, stageHeight } = settings.value

  for (const layer of componentLayers.value) {
    const element = stagesRoot.value.querySelector<HTMLElement>(`[data-stage="${layer.id}"]`)
    if (!element) continue

    let serializer = stageTextures.get(layer.id)
    if (!serializer) {
      serializer = createDomTexture()
      stageTextures.set(layer.id, serializer)
    }

    const { image, markup } = await serializer.capture(element, stageWidth, stageHeight, PLATE_SCALE)
    if (!renderer) return
    // Null means the markup was unchanged and the uploaded texture still stands.
    if (image) renderer.setLayerTexture(layer.id, image)

    rememberPlate(layer.id, clock?.now ?? 0, markup)

    // Recorded on every pass, not only when a new picture arrives. A capture
    // that reports "unchanged" would otherwise never restore an aspect that
    // something else had dropped, and the plane would stay missing for good.
    setAspect(layer.id, stageAspect.value)
  }

  captureMs.value = Date.now() - started
}

/**
 * Step the clock to a point in component time.
 *
 * Forward is cheap — the clock only ever runs forward, so it is a matter of
 * advancing it. Backward is not: a sequence cannot be un-run, so the component
 * is remounted at zero and replayed. That is the same path the export takes, so
 * whatever the playhead shows is what will be rendered.
 */
async function runSeek(goal: number) {
  if (!clock) return

  // `sceneOutOfStep` forces the replay branch: the frame on screen came from the
  // cache, so the clock's idea of where the scene is no longer matches what the
  // live components are actually showing, and stepping forward from it would
  // carry that disagreement into everything after.
  if (goal < clock.now - 1 || sceneOutOfStep || replayedSignature !== originSignature.value) {
    sceneOutOfStep = false
    replayedSignature = originSignature.value
    clock.reset(stageOrigin.value)
    playhead.value = clock.now
    invalidateStageMarkup()
    stageKey.value++
    await nextTick()
    // Most of these components start themselves from an IntersectionObserver,
    // which fires on a real task rather than on a frame.
    await realDelay(120)
  }

  await advanceToTime(goal)

  // One settled frame at the end, so any transition the last step started is
  // registered before the plate is captured.
  await clock.advance(0)
  await captureStage().catch(() => {})
  await syncVideoFrames(goal, true)
}

/**
 * Run the clock up to `goal`, one output frame at a time.
 *
 * Stepping on the frame grid rather than by an arbitrary interval is what makes
 * a scrub land on the same state the export will render at that instant.
 */
async function advanceToTime(goal: number) {
  if (!clock) return
  const step = frameStep(settings.value)
  let guard = 0
  while (clock.now < goal - 0.001 && guard++ < 20000) {
    const before = clock.now
    clock.advanceSync(Math.min(step, goal - clock.now))
    const after = clock.now
    playhead.value = after

    // A staged component whose origin the clock has just passed has to be
    // mounted and running before time moves on without it — that mount is what
    // sets where in its own sequence the clip is.
    const crossed = componentLayers.value.some((layer) => {
      const origin = layerOrigin(layer)
      return origin > before && origin <= after
    })
    if (crossed) {
      await nextTick()
      // Most of these components start themselves from an IntersectionObserver,
      // which fires on a real task rather than on a frame.
      await realDelay(120)
    }
  }
}

/**
 * Where the replay has to begin.
 *
 * A clip trimmed past its own placement needs its source to have been running
 * before the take opens — a cut at 1.5s whose tail is dragged to zero is asking
 * for an animation that is already 1.5s old on the first frame. So the clock
 * starts early and the take joins a replay in progress. Zero when nothing is
 * trimmed, which is every document that has never been cut.
 */
const stageOrigin = computed(() => Math.min(0, ...componentLayers.value.map(layerOrigin)))

/**
 * When the replay itself, rather than the position in it, has changed.
 *
 * Moving a clip or cutting one moves the instant its source starts, and a
 * running scene cannot be corrected in place — the component would have to
 * un-run. So the whole take is replayed from the earliest origin whenever any of
 * them moves, which is the same path a backward scrub already takes.
 */
const originSignature = computed(() => componentLayers.value
  .map(layer => `${layerOrigin(layer)}@${layerSpeed(layer)}`)
  .join(','))
let replayedSignature: string | null = null

/**
 * Frames already seen, kept so going back does not mean going again.
 *
 * Backwards is the expensive direction: a sequence cannot be un-run, so landing
 * on an earlier instant means remounting the scene and replaying it. That is why
 * dragging the playhead left sat on a stale frame and then flashed through a
 * replay, while dragging right was smooth — one direction was reading, the other
 * was re-deriving.
 *
 * A frame is cached as the stage's markup, not as pixels: tens of kilobytes
 * instead of megabytes, so a whole take fits where a couple of seconds of
 * texture would not. Replaying one is a decode.
 */
const plateFrames = new Map<string, PlateMarkup>()
/** Enough for a long take at 60fps, bounded so a session cannot grow without end. */
const MAX_CACHED_FRAMES = 1200

function frameKey(layerId: string, time: number): string {
  return `${layerId}@${Math.round(time / frameStep(settings.value))}`
}

function rememberPlate(layerId: string, time: number, markup: PlateMarkup) {
  if (plateFrames.size >= MAX_CACHED_FRAMES) {
    // Oldest first: insertion order is play order, and the frames you are about
    // to scrub back through are the ones you just made.
    const oldest = plateFrames.keys().next().value
    if (oldest) plateFrames.delete(oldest)
  }
  plateFrames.set(frameKey(layerId, time), markup)
}

/**
 * Anything that changes what a plate looks like invalidates every frame of it.
 *
 * Kept deliberately broad. A stale plate is a wrong picture presented as a real
 * one, which is far worse than the cost of filling the cache again.
 */
watch(
  () => [settings.value.stageWidth, settings.value.stageHeight, stageKey.value, originSignature.value].join(':'),
  () => plateFrames.clear(),
)

/**
 * Paint an earlier instant from what was already seen.
 *
 * Only used while the playhead is being dragged. It moves the picture, not the
 * scene: the live components stay where the clock left them, and the drag ending
 * is what reconciles the two. Returns false if any layer is missing that frame,
 * in which case the caller falls back to replaying properly.
 */
async function previewCachedFrame(time: number): Promise<boolean> {
  if (!renderer || !componentLayers.value.length) return false

  const wanted = componentLayers.value.map(layer => ({
    id: layer.id,
    markup: plateFrames.get(frameKey(layer.id, time)),
  }))
  if (wanted.some(entry => !entry.markup)) return false

  for (const entry of wanted) {
    const serializer = stageTextures.get(entry.id)
    if (!serializer || !entry.markup) return false
    const image = await serializer.rasterize(entry.markup)
    if (!renderer) return false
    renderer.setLayerTexture(entry.id, image)
  }
  return true
}

/** Latest requested position while a seek is already running. */
let pendingSeek: number | null = null

/** True while the playhead is being dragged along the ruler. */
const scrubDragging = ref(false)
/** The last position the pointer asked for, as opposed to where the replay is. */
let scrubTarget = 0

/**
 * Dragging the playhead, in the direction that costs something.
 *
 * Forward is cheap: the clock advances and the sequence carries on. Backward is
 * not — a sequence cannot be un-run, so every backward step remounts the scene
 * and replays it from the beginning, each one costing a mount and a wait for the
 * observers that start these components. A drag emits dozens of positions, and
 * chaining a replay to each of them is why pulling the playhead left felt like
 * dragging through treacle while pulling it right was fine.
 *
 * So a backward move during a drag waits for the pointer to pause. The marker
 * has already gone where you put it, and the picture lands on the position you
 * settled on rather than on every position you passed through.
 */
function onScrub(target: number) {
  // Remembered, because `playhead` cannot serve as the record of it: a replay
  // walks the playhead forward one frame at a time, so reading it back mid-seek
  // returns wherever the walk had got to. Ending a drag on that value sent the
  // take back to the start of the replay it was in the middle of.
  scrubTarget = target

  if (!scrubDragging.value || !clock || target >= clock.now - 1) {
    void seekTo(target)
    return
  }

  // Backwards, mid-drag. Show the frame rather than rebuild it: the picture
  // keeps up with the pointer the way a video would, and the scene is put back
  // in step once, when the drag ends.
  playhead.value = Math.max(0, Math.min(target, settings.value.timelineLength))
  void paintCached(playhead.value)
}

let painting = false

async function paintCached(time: number) {
  if (painting || !renderer) return
  painting = true
  try {
    if (await previewCachedFrame(time)) {
      sceneOutOfStep = true
      renderer?.render(shotSettings.value, clock?.now ?? 0, layerPlanes.value, overlayQuads.value)
    }
  } finally {
    painting = false
  }
}

/**
 * True when the picture on screen came from the cache and the live scene has
 * not been moved to match it. The next real seek has to replay rather than
 * assume it can step forward from where the clock happens to be.
 */
let sceneOutOfStep = false

function endScrub() {
  scrubDragging.value = false
  // Land on where the drag finished, whatever the last cached frame showed.
  void seekTo(scrubTarget)
}

async function seekTo(target: number) {
  const clamped = Math.max(0, Math.min(target, settings.value.timelineLength))
  playhead.value = clamped
  pendingSeek = clamped
  if (seeking.value) return

  seeking.value = true
  try {
    // Coalesce: a drag emits far more positions than a replay can service, and
    // only the most recent one is worth honouring.
    while (pendingSeek !== null) {
      const goal = pendingSeek
      pendingSeek = null
      await runSeek(goal)
    }
  } finally {
    seeking.value = false
  }
}

/** Live loop: re-serialize the DOM on a budget, but composite every frame. */
function tick(now: number) {
  rafHandle = clock?.raf(tick) ?? 0

  // Let the interface have its frame. The clock's patch is global, so every
  // Vue transition in the lab queues against it and would otherwise wait for a
  // playhead that is standing still.
  clock?.flush()

  // Nothing to draw for: the frame is covered. Serializing the stage and
  // compositing behind a full-screen sheet costs exactly as much as doing it in
  // view, and on a real GPU that is enough to make the sheet itself feel stuck.
  if (busy.value || !renderer || shortcutsOpen.value || projectsOpen.value) return

  // Step the staged component by the real elapsed time, scaled. The clock is
  // virtual even in preview, so `speed` is honoured on screen and not just in
  // the export — what you grade is what you get.
  //
  // The delta is clamped because a background tab or a long capture can leave a
  // gap of seconds, and replaying that in one step would skip the sequence.
  const delta = lastFrameAt ? Math.min(now - lastFrameAt, 100) : 0
  lastFrameAt = now

  if (playing.value && !seeking.value) {
    // Play on the frame grid too: the preview then shows the frames that will
    // be exported, not an interpolation between them.
    frameDebt += delta * settings.value.speed
    const step = frameStep(settings.value)
    let steps = 0
    while (frameDebt >= step && steps++ < 8) {
      clock?.advanceSync(step)
      frameDebt -= step
    }
    playhead.value = clock?.now ?? 0
    // Loop the trimmed segment rather than the whole timeline: while grading,
    // the part being watched is the part being exported.
    if (playhead.value >= settings.value.timelineLength) void seekTo(0)
  }

  if (hasVideoLayer.value && !videoSyncing) {
    videoSyncing = true
    void syncVideoFrames(playhead.value, false).finally(() => {
      videoSyncing = false
    })
  }

  // Grain and any future time-based effect stay smooth at display rate even
  // though the plate underneath refreshes more slowly.
  renderer.render(shotSettings.value, now, layerPlanes.value, overlayQuads.value)

  // Adaptive pacing. Serializing the stage is synchronous main-thread work, so
  // a fixed 30Hz schedule on a component that costs 80ms per capture leaves no
  // room for anything else and the whole UI stutters. Spacing captures by what
  // the last one actually cost keeps the compositor — and slider dragging —
  // responsive, at the price of a plate that refreshes less often.
  const interval = Math.min(250, Math.max(1000 / 30, captureMs.value * 1.6))
  if (!capturing && now - lastCaptureAt >= interval) {
    capturing = true
    lastCaptureAt = now
    captureStage()
      // Clear on success: a transient failure (a font still loading, a mid-swap
      // component) should not leave a banner up for the rest of the session.
      .then(() => {
        error.value = ''
      })
      .catch((cause) => {
        error.value = cause instanceof Error ? cause.message : String(cause)
      })
      .finally(() => {
        capturing = false
      })
  }
}

onMounted(async () => {
  if (!canvas.value) return
  try {
    renderer = new LabRenderer(canvas.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    return
  }

  highPrecision.value = renderer.highPrecision
  renderer.setStageAspect(stageAspect.value)
  handOverGlyphs()
  clock = createClock()
  // Virtual from the start: the preview is then the same function of time the
  // export is, so a shot cannot look different once rendered.
  clock.enterVirtual()

  // The canvas' CSS size comes from its container and aspect ratio, never from
  // its backing store, so observing it cannot feed back into itself.
  observer = new ResizeObserver(([entry]) => {
    const box = entry?.contentRect
    if (box) displaySize.value = { width: box.width, height: box.height }
  })
  observer.observe(canvas.value)

  renderer.resize(previewSize.value.width, previewSize.value.height)
  // First capture before the loop starts, so the first painted frame already
  // has the component in it rather than a black flash.
  await captureStage().catch(() => {})
  await syncLayerTextures()
  rafHandle = clock.raf(tick)

  // A document that opens on a trimmed clip has to run its pre-roll before the
  // first frame is anything but a guess. Nothing else asks for a seek on load,
  // so without this the take opened on the top of a sequence the timeline says
  // was already part-way through — and stayed wrong until the playhead moved.
  if (stageOrigin.value < 0) await seekTo(playhead.value)

  // The launcher lists them, so they have to be in hand before it is shown.
  await refreshProjects()

  if (chrome.value) installCues(chrome.value)
})

onBeforeUnmount(() => {
  clock?.cancelRaf(rafHandle)
  observer?.disconnect()
  clock?.dispose()
  for (const serializer of stageTextures.values()) serializer.dispose()
  stageTextures.clear()
  renderer?.dispose()
})

watch(previewSize, (size) => {
  if (!busy.value) renderer?.resize(size.width, size.height)
})

watch(stageAspect, aspect => renderer?.setStageAspect(aspect))

/**
 * The ascii ramp in hand, kept rather than handed straight to the renderer.
 *
 * Building one waits on the fonts and the renderer is built on mount, so the two
 * arrive in either order — and on a shot that opens with ascii already set, the
 * atlas usually wins. Holding it here lets whichever is second do the handover,
 * instead of the first one being dropped into a renderer that does not exist yet
 * and never being offered again.
 */
let glyphs: GlyphAtlas | null = null

function handOverGlyphs() {
  if (glyphs) renderer?.setGlyphAtlas(glyphs.canvas, glyphs.count, glyphs.gain)
}

/**
 * Keep that ramp in step with what the shot asks for.
 *
 * Only once something actually asks: building one measures every glyph in it
 * against the loaded fonts, and a shot that never turns the screen on should not
 * pay for four of them. The frame that lands before the atlas does draws
 * unstylized — the render loop picks the screen up on the next one.
 */
watch(
  () => [shotSettings.value.stylize, shotSettings.value.asciiSet] as const,
  async ([mode, set]) => {
    if (mode !== 'ascii') return
    glyphs = await glyphAtlas(set)
    handOverGlyphs()
  },
  { immediate: true },
)

/**
 * Remount only when a layer changes which component it stages.
 *
 * Comparing the joined list meant splitting a clip — which duplicates a name —
 * read as a change and restarted every animation on the timeline. Adding or
 * removing a layer needs no remount either: Vue mounts the new stage and drops
 * the old one on its own.
 */
let stagedBefore = new Map<string, string | undefined>()
watch(componentLayers, (list) => {
  const now = new Map(list.map(layer => [layer.id, layer.component]))
  const swapped = [...now].some(([id, component]) => stagedBefore.has(id) && stagedBefore.get(id) !== component)
  stagedBefore = now
  if (!swapped) return
  stageKey.value++
  lastCaptureAt = 0
}, { deep: true, immediate: true })

/**
 * A cut, or a clip moved, takes effect immediately.
 *
 * `runSeek` already replays whenever the origins have shifted, but it only runs
 * when someone scrubs. Without this, splitting a clip left the scene exactly as
 * it was until the next seek — the edit had happened everywhere except on
 * screen, which reads as the split having done nothing at all.
 */
watch(originSignature, () => {
  if (busy.value) return
  void seekTo(playhead.value)
})

// Re-serializing after a size change picks up the new layout; without it the
// plate keeps the old aspect until the next scheduled capture.
watch([() => settings.value.stageWidth, () => settings.value.stageHeight], () => {
  lastCaptureAt = 0
})

// Persist the working copy. Debounced because dragging a control fires on every
// pointer move, and serialising on each one is wasted work.
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch([settings, layers, camera], () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const saved = saveStored(currentDocument())
    // Surfaced rather than logged: losing a project on the next reload is not
    // something to discover afterwards.
    if (!saved.ok) error.value = saved.reason
  }, 300)
}, { deep: true })
onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  // Flush, so a reload right after a change does not lose it.
  saveStored(currentDocument())
})

/** Force every stage to re-serialize, after a remount reset their DOM. */
function invalidateStageMarkup() {
  for (const serializer of stageTextures.values()) serializer.invalidate()
}

/**
 * Back to the top, rolling.
 *
 * The take has no in point — one existed briefly and the timeline is measured
 * from zero now — so the top is zero. This used to seek to a field that had gone
 * with it, which is `undefined`, which clamps to `NaN`, which takes no branch:
 * the button and the `R` key both quietly meant "resume from wherever you are".
 */
function replay() {
  playing.value = true
  void seekTo(0)
}

function togglePlay() {
  playing.value = !playing.value
  cue(playing.value ? 'press' : 'release')
  // Resuming past the end would sit on a frame where every layer has finished,
  // which is simply black; drop back to the top instead.
  if (playing.value && playhead.value >= settings.value.timelineLength) void seekTo(0)
}

const selectedLayer = computed(() => layers.value.find(layer => layer.id === selectedId.value) ?? null)
const selectedShotLayer = computed(() => mode.value === 'video' ? selectedLayer.value : null)

const editorShotSettings = computed<LabSettings>({
  get: () => resolveLayerShotSettings(settings.value, selectedShotLayer.value),
  set: next => updateShotSettings(next),
})

const editorCamera = computed({
  get: () => selectedShotLayer.value?.shot?.camera ?? camera.value,
  set: (moves) => {
    const layer = selectedShotLayer.value
    if (!layer) {
      camera.value = moves
      return
    }
    updateLayer(layer.id, { shot: { ...layer.shot, camera: moves } })
    previewSelectedShot(layer)
  },
})

const selectedShotCustomized = computed(() => Boolean(selectedShotLayer.value && hasLayerShot(selectedShotLayer.value)))

function updateShotSetting(key: ShotSettingKey, value: ShotSettings[ShotSettingKey]) {
  const layer = selectedShotLayer.value
  if (!layer) {
    Object.assign(settings.value, { [key]: value })
    return
  }

  updateLayer(layer.id, {
    shot: {
      ...layer.shot,
      settings: { ...layer.shot?.settings, [key]: value },
    },
  })
  previewSelectedShot(layer)
}

function updateShotSettings(next: LabSettings) {
  const current = editorShotSettings.value
  const changed = SHOT_SETTING_KEYS.filter(key => next[key] !== current[key])
  if (!changed.length) return

  const layer = selectedShotLayer.value
  if (!layer) {
    for (const key of changed) Object.assign(settings.value, { [key]: next[key] })
    return
  }

  const overrides: Partial<ShotSettings> = { ...layer.shot?.settings }
  for (const key of changed) Object.assign(overrides, { [key]: next[key] })
  updateLayer(layer.id, { shot: { ...layer.shot, settings: overrides } })
  previewSelectedShot(layer)
}

function previewSelectedShot(layer: Layer) {
  if (playhead.value < layer.start || playhead.value > layerEnd(layer)) void seekTo(layer.start)
}

function resetSelectedShot() {
  const layer = selectedShotLayer.value
  if (layer) updateLayer(layer.id, { shot: undefined })
}

/** Layers are placed against the stage, so their geometry needs its size. */
const stageBox = computed(() => ({ width: settings.value.stageWidth, height: settings.value.stageHeight }))

/**
 * Layer art, uploaded once per change rather than once per frame.
 *
 * The key covers everything the picture depends on — text, type, colour, size —
 * and deliberately excludes opacity, placement and depth, which are uniforms.
 * That is what makes a fade free: it moves a number, it does not redraw a title.
 */
const textureKeys = new Map<string, string>()
/** Aspect of each layer's art, so a plane can be sized to its content. */
const layerAspects = ref(new Map<string, number>())

/**
 * Write one entry, always against the current table.
 *
 * Batching these through a snapshot taken before an `await` loses whatever was
 * recorded in the meantime — and since a stage capture reports "unchanged" on
 * the following frame, a lost aspect never came back and the plane vanished.
 */
function setAspect(id: string, aspect: number) {
  if (layerAspects.value.get(id) === aspect) return
  layerAspects.value = new Map(layerAspects.value).set(id, aspect)
}

function dropAspect(id: string) {
  if (!layerAspects.value.has(id)) return
  const next = new Map(layerAspects.value)
  next.delete(id)
  layerAspects.value = next
}

async function syncLayerTextures() {
  if (!renderer) return
  const live = new Set(layers.value.map(layer => layer.id))

  for (const id of [...textureKeys.keys()]) {
    if (live.has(id)) continue
    renderer.dropLayerTexture(id)
    textureKeys.delete(id)
    dropAspect(id)
  }
  for (const id of [...stageTextures.keys()]) {
    if (live.has(id)) continue
    stageTextures.get(id)?.dispose()
    stageTextures.delete(id)
    renderer.dropLayerTexture(id)
    dropAspect(id)
  }

  for (const layer of layers.value) {
    // Component layers get their picture from the stage capture instead.
    if (layer.kind === 'component') continue
    const key = layerTextureKey(layer, stageBox.value, PLATE_SCALE)
    if (textureKeys.get(layer.id) === key) continue

    const bitmap = await rasterizeLayer(layer, stageBox.value, PLATE_SCALE)
    if (!renderer) return
    if (!bitmap) {
      // Empty text, or an image that would not decode: drop whatever was there
      // rather than leaving the previous picture behind.
      renderer.dropLayerTexture(layer.id)
      textureKeys.delete(layer.id)
      dropAspect(layer.id)
      continue
    }
    renderer.setLayerTexture(layer.id, bitmap.source)
    textureKeys.set(layer.id, key)
    setAspect(layer.id, bitmap.aspect)
  }
}

watch(
  [layers, () => settings.value.stageWidth, () => settings.value.stageHeight],
  () => void syncLayerTextures(),
  { deep: true },
)

/**
 * The layers currently in shot, resolved into planes.
 *
 * A layer outside its span contributes nothing, so it is dropped before it ever
 * reaches a draw call.
 */
/**
 * Overlay layers, in frame fractions.
 *
 * Their geometry is expressed against the output frame rather than the stage,
 * because that is what they sit on — an overlay does not belong to the staged
 * surface and must not move when the stage is resized.
 */
const overlayQuads = computed<OverlayQuad[]>(() => {
  const frameAspect = settings.value.outputWidth / settings.value.outputHeight
  return layers.value.flatMap((layer) => {
    if (layer.space !== 'overlay') return []
    const state = stateOf(layer)
    const aspect = layerAspects.value.get(layer.id)
    if (!state || !aspect) return []

    const halfWidth = (layer.width * state.scale) / 2
    return [
      {
        id: layer.id,
        // Effects displace in scene units; halved here to read the same on screen.
        x: layer.x + state.offsetX / 2,
        // Layer Y runs top-down, the frame runs bottom-up.
        y: 1 - layer.y + state.offsetY / 2,
        halfWidth,
        halfHeight: (halfWidth * frameAspect) / aspect,
        rotation: layer.rotation + state.rotation,
        opacity: state.opacity,
      }
    ]
  })
})

const layerPlanes = computed<LayerPlane[]>(() => {
  const stage = stageBox.value
  // The plate is two world units tall by definition, so a fraction of the stage
  // converts straight into world units against that.
  const planeWidthFor = (fraction: number) => fraction * (stage.width / stage.height)

  return layers.value.flatMap((layer) => {
    if (layer.space === 'overlay') return []
    const state = stateOf(layer)
    const aspect = layerAspects.value.get(layer.id)
    if (!state || !aspect) return []

    // Effects displace the layer from where it rests, so they add to its
    // authored placement rather than replacing it.
    const halfWidth = planeWidthFor(layer.width) * state.scale
    const halfHeight = layer.kind === 'component'
      // A staged component is the plate: its height is the scene's unit height,
      // so `width` scales it about that rather than deriving from a bitmap.
      ? (halfWidth / (stage.width / stage.height))
      : halfWidth / aspect
    return [
      {
        id: layer.id,
        depth: layerDepth(layer) + state.depth,
        // Stage fractions run top-down; the scene's Y axis runs up.
        offsetX: (layer.x - 0.5) * 2 * (stage.width / stage.height) + state.offsetX,
        offsetY: -(layer.y - 0.5) * 2 + state.offsetY,
        halfWidth,
        halfHeight: halfWidth / aspect,
        rotation: layer.rotation + state.rotation,
        opacity: state.opacity,
        emission: shotSettings.value.emission,
      },
    ]
  })
})

function addLayer(layer: Layer) {
  const placed = constrainToTimeline(layer, settings.value.timelineLength)
  layers.value = [...layers.value, placed]
  selectedId.value = placed.id
}

/** New layers open at the playhead: where you are is where you are composing. */
function defaultSpan() {
  const start = Math.min(playhead.value, Math.max(0, settings.value.timelineLength - 1500))
  return { start, duration: Math.min(2000, settings.value.timelineLength - start) }
}

function addText() {
  const { start, duration } = defaultSpan()
  addLayer(createTextLayer(start, duration))
}

const fileInput = useTemplateRef('fileInput')

function addMedia() {
  fileInput.value?.click()
}

/**
 * The bytes, stored once, and a reference to them.
 *
 * Media is not inlined into the document any more. A layer points at a hash and
 * the file itself lives in IndexedDB, which is what lets a shot with a video in
 * it fit in the working copy, in an undo snapshot, and in a project file that is
 * the bytes rather than a third more than the bytes.
 */
async function storeFile(file: File): Promise<string> {
  try {
    return await putAsset(file, file.name)
  } catch {
    error.value = `${file.name} could not be stored. The browser may be out of room for this site.`
    return ''
  }
}

/**
 * Place one file as a clip starting at `start`, and report where it ends.
 *
 * The end is what makes a multi-file drop land as a sequence rather than as a
 * stack: each clip starts where the last one finished.
 */
async function importFile(file: File, start: number): Promise<number> {
  const src = await storeFile(file)
  if (!src) return start

  const name = file.name.replace(/\.[^.]+$/, '')
  const isVideo = file.type.startsWith('video/')

  let length = defaultSpan().duration
  if (isVideo) {
    const video = await getVideo(src)
    if (!video) {
      error.value = `${file.name} could not be decoded. Chrome plays MP4/H.264 and WebM.`
      return start
    }
    // Footage opens at its own length: importing a clip and having it silently
    // truncated to a default span is not useful.
    length = Math.round(video.duration * 1000) || 2000
  }

  // Make room before adding rather than clamping into what is already there —
  // otherwise a clip dropped past the end of the take is quietly dragged back on
  // top of the one before it. The timeline follows its content anyway, so this
  // only ever pre-empts the growth the watcher is about to apply.
  settings.value.timelineLength = Math.max(
    settings.value.timelineLength,
    start + length + settings.value.tail,
  )

  addLayer(createMediaLayer({ kind: isVideo ? 'video' : 'image', start, duration: length, src, name }))
  return start + length
}

async function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  await importFiles(files, defaultSpan().start)
}

/**
 * Media dropped onto the timeline, laid end to end from where it landed.
 *
 * One at a time, in order: two `await`s racing on the same cursor would put both
 * clips at the same start, and the reason to drop at a point on the timeline is
 * to say where things go.
 */
async function importFiles(files: File[], atMs: number) {
  let cursor = Math.max(0, atMs)
  for (const file of files) {
    cursor = await importFile(file, cursor)
  }
}

/**
 * Put every video on the frame the playhead is on.
 *
 * Separate from the texture cache because a video is the one layer whose picture
 * is a function of time — the others are drawn once and then only moved.
 */
async function syncVideoFrames(time: number, exact: boolean) {
  if (!renderer) return
  for (const layer of layers.value) {
    if (!isTimeVarying(layer) || !layer.src) continue
    if (!layerStateAt(layer, time)) continue

    const video = await getVideo(layer.src)
    if (!video?.videoWidth || !renderer) continue
    await seekVideo(video, layerSourceTimeAt(layer, time) / 1000, exact)
    renderer.setLayerTexture(layer.id, video)
  }
}

const hasVideoLayer = computed(() => layers.value.some(isTimeVarying))

function updateLayer(id: string, patch: Partial<Layer>) {
  layers.value = layers.value.map(layer => (layer.id === id ? { ...layer, ...patch } : layer))
}

function removeSelected() {
  if (!selectedId.value) return
  layers.value = layers.value.filter(layer => layer.id !== selectedId.value)
  selectedId.value = null
}

function duplicateSelected() {
  const layer = selectedLayer.value
  if (!layer) return
  // Offset by its own length so the copy sits after the original rather than
  // hiding underneath it.
  const copy = constrainToTimeline(
    { ...cloneLayer(layer), start: layer.start + layer.duration },
    settings.value.timelineLength,
  )
  layers.value = [...layers.value, copy]
  selectedId.value = copy.id
}

function splitLayer(id: string) {
  const layer = layers.value.find(entry => entry.id === id)
  if (!layer) return
  const at = playhead.value
  if (at <= layer.start + 100 || at >= layerEnd(layer) - 100) return

  // The tail keeps the exit effects and the head keeps the entrance, which is
  // what makes a split read as a cut rather than as two half-animated clips.
  const head: Layer = { ...layer, duration: at - layer.start, effects: layer.effects.filter(e => e.at === 'in') }
  const tail: Layer = {
    ...cloneLayer(layer, ''),
    start: at,
    duration: layerEnd(layer) - at,
    // The cut moves the tail's way into its source as well as its place on the
    // timeline. Without this the second piece plays its media from the top, so
    // dragging it back to zero replays what the first piece already showed
    // instead of carrying on from the frame the blade landed on.
    trim: (layer.trim ?? 0) + (at - layer.start) * layerSpeed(layer),
    effects: layer.effects.filter(e => e.at === 'out'),
  }
  layers.value = layers.value.flatMap(entry => (entry.id === id ? [head, tail] : [entry]))
  selectedId.value = tail.id
}

/** The clip this one can be rejoined with, if any. */
function joinPartner(layer: Layer): Layer | null {
  return layers.value.find(other => other.id !== layer.id && canJoin(layer, other))
    ?? layers.value.find(other => other.id !== layer.id && canJoin(other, layer))
    ?? null
}

function joinLayer(id: string) {
  const layer = layers.value.find(entry => entry.id === id)
  if (!layer) return
  const partner = joinPartner(layer)
  if (!partner) return

  const [first, second] = layer.start <= partner.start ? [layer, partner] : [partner, layer]
  const merged: Layer = {
    ...first,
    duration: layerEnd(second) - first.start,
    // The entrance from the head and the exit from the tail: the same two ends
    // the split handed out, so a cut and a join return you to where you began.
    effects: [
      ...first.effects.filter(effect => effect.at === 'in'),
      ...second.effects.filter(effect => effect.at === 'out'),
    ],
  }

  layers.value = layers.value
    .filter(entry => entry.id !== second.id)
    .map(entry => (entry.id === first.id ? merged : entry))
  selectedId.value = merged.id
}

/**
 * Move a track up or down the stack.
 *
 * Order is draw order — later layers land on top — so this is how something gets
 * put in front of something else. It is the one property of a layer that cannot
 * be expressed as a number in the panel.
 */
function reorderLayers(from: number, to: number) {
  const next = [...layers.value]
  const [moved] = next.splice(from, 1)
  if (!moved) return
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  layers.value = next
}

/** One step forward or back in the stack, from the layers list. */
function shiftLayer(id: string, direction: -1 | 1) {
  const from = layers.value.findIndex(layer => layer.id === id)
  if (from === -1) return
  reorderLayers(from, from + direction)
}

function copyLayer(id: string) {
  const layer = layers.value.find(entry => entry.id === id)
  if (layer) clipboard = { ...layer }
}

/** An in-app clipboard: the system one cannot hold a layer. */
let clipboard: Layer | null = null

function copySelected() {
  if (selectedLayer.value) clipboard = { ...selectedLayer.value }
}

function pasteClipboard() {
  if (!clipboard) return
  // Pasted at the playhead, which is where a paste is aimed.
  const copy = constrainToTimeline(
    { ...cloneLayer(clipboard, ''), start: playhead.value },
    settings.value.timelineLength,
  )
  layers.value = [...layers.value, copy]
  selectedId.value = copy.id
}


/**
 * Set the focal plane from a click on the frame.
 *
 * The canvas is letterboxed inside its box by `object-fit`-style CSS, but its
 * element box matches the frame exactly (aspect-ratio plus max-width/height), so
 * the element's own rect is the frame and no letterbox correction is needed.
 */
function focusFromPointer(clientX: number, clientY: number, box: DOMRect): number | null {
  if (!renderer || !box.width || !box.height) return null
  const ndcX = ((clientX - box.left) / box.width) * 2 - 1
  // Clip space has y up; a pointer event has it down.
  const ndcY = 1 - ((clientY - box.top) / box.height) * 2
  return renderer.focusAt(shotSettings.value, ndcX, ndcY)
}

/**
 * Focus follows the reticle, live.
 *
 * Aiming a focal plane by clicking and judging the result is a guessing game:
 * the whole point of a shallow depth of field is what it does to everything you
 * did not aim at, and that cannot be read from a number. Racking it under the
 * pointer turns it into what a focus ring actually is — you watch the frame, not
 * the control.
 *
 * It is affordable because none of it is a render: the plane is found by
 * intersecting one ray with one plane, and the frame was going to be drawn this
 * tick regardless.
 */
function onFocusHover(event: PointerEvent) {
  if (!picking.value) return
  const focus = focusFromPointer(event.clientX, event.clientY, (event.currentTarget as HTMLElement).getBoundingClientRect())
  if (focus !== null) updateShotSetting('focus', Number(focus.toFixed(3)))
}

/** What focus was before the reticle was armed, so leaving without a click undoes it. */
let focusBeforePicking = 0
let focusOverrideBeforePicking: number | undefined

watch(picking, (armed) => {
  if (!armed) return
  focusBeforePicking = editorShotSettings.value.focus
  focusOverrideBeforePicking = selectedShotLayer.value?.shot?.settings?.focus
})

function cancelPicking() {
  if (!picking.value) return
  const layer = selectedShotLayer.value
  if (layer && focusOverrideBeforePicking === undefined) {
    updateLayer(layer.id, { shot: withoutLayerShotSetting(layer, 'focus') })
  } else {
    updateShotSetting('focus', focusBeforePicking)
  }
  picking.value = false
}

function onFrameClick(event: MouseEvent) {
  // Clicking the frame itself is clicking nothing in particular, so it clears
  // the selection — and the panel, having only the shot left to show, shows it.
  // Leaving a clip selected while you work on the camera means the next delete
  // or paste lands somewhere you stopped thinking about.
  if (!picking.value) {
    selectedId.value = null
    return
  }

  // The hover has already set it; the click is what makes it stick.
  const focus = focusFromPointer(event.clientX, event.clientY, (event.currentTarget as HTMLElement).getBoundingClientRect())
  if (focus !== null) updateShotSetting('focus', Number(focus.toFixed(3)))
  focusBeforePicking = editorShotSettings.value.focus
  picking.value = false
}

/**
 * Shrink the stage to the height the component actually occupies.
 *
 * Most of these demos are far shorter than the default stage, and the empty
 * plate below them is dead frame the camera still has to compose around.
 */
function fitStage() {
  // Any stage will do — they are all laid out at the same size — but it has to be
  // a stage. `stage` was never declared, so this threw the moment it was clicked.
  const stage = stagesRoot.value?.querySelector<HTMLElement>('[data-stage]')
  const content = stage?.firstElementChild
  if (!content) return
  const height = Math.ceil(content.getBoundingClientRect().height)
  if (height > 0) settings.value.stageHeight = Math.min(1600, Math.max(240, height))
  lastCaptureAt = 0
}

/**
 * Whether the playhead is inside a clip's span.
 *
 * Only for the eye: with the stages overlapping, `show the plain layout` has to
 * put the clip you are actually looking at in front of the others.
 */
function isLive(layer: Layer): boolean {
  return playhead.value >= layer.start && playhead.value <= layerEnd(layer)
}

/** Back to a square-on, edge-to-edge framing without touching the grade. */
function resetCamera() {
  editorShotSettings.value = {
    ...editorShotSettings.value,
    pitch: 0,
    yaw: 0,
    roll: 0,
    zoom: 1,
    focus: 0.5,
    panX: 0,
    panY: 0,
  }
}

/**
 * Back to defaults, keeping the shot itself.
 *
 * The component and the layers are the project; everything else is how it is
 * being filmed. Wiping the lot would mean re-importing media to undo a bad
 * grade, so they survive.
 */
function resetSettings() {
  settings.value = { ...DEFAULT_SETTINGS }
  camera.value = []
  void seekTo(0)
}

function resetEverything() {
  layers.value = [createComponentLayer(DEFAULT_COMPONENT, 0, DEFAULT_SETTINGS.timelineLength)]
  selectedId.value = null
  camera.value = []
  settings.value = { ...DEFAULT_SETTINGS }
  void seekTo(0)
}

/** Add another built-in animation as a layer. */
function addComponent() {
  const { start, duration } = defaultSpan()
  const layer = createComponentLayer(DEFAULT_COMPONENT, start, duration)
  // The default span is a placeholder: it holds for the frame or two before the
  // animation reports its real length, and for good on the few that never do.
  awaitingFit.add(layer.id)
  addLayer(layer)
}

/**
 * Cut a clip to the length its animation declares.
 *
 * Reported in source milliseconds. A trimmed or retimed clip gets the timeline
 * span left before that source reaches its end.
 */
function fitToSequence(id: string, reportedMs: number) {
  const layer = layers.value.find(candidate => candidate.id === id)
  if (!layer) return
  const duration = layerDurationForSourceEnd(layer, reportedMs)
  if (Math.abs(layer.duration - duration) < 50) return
  layers.value = layers.value.map(candidate =>
    candidate.id === id ? { ...candidate, duration } : candidate,
  )
}

const sequenceDurations = useSequenceDurations()

/** The length the selected clip's animation declares, if it declares one. */
const selectedSequenceMs = computed(() =>
  selectedId.value ? sequenceDurations.value[selectedId.value] : undefined,
)

// Only clips still waiting are touched. Every remount re-reports, and a shot
// where every trim snapped back to the full cycle on reload would be worse than
// one that never fitted anything.
watch(sequenceDurations, (reported) => {
  if (!awaitingFit.size) return
  for (const [id, ms] of Object.entries(reported)) {
    if (!awaitingFit.has(id)) continue
    awaitingFit.delete(id)
    fitToSequence(id, ms)
  }
}, { deep: true })

const linkCopied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyLink() {
  // Media lives in this browser now, so a link that names it would arrive on the
  // other machine pointing at nothing. Said here rather than letting the layer
  // quietly fail to draw for whoever opened it.
  if (layers.value.some(layer => isAssetRef(layer.src))) {
    error.value = 'A link cannot carry imported media — it stays in this browser. Export the project instead, from Projects.'
    return
  }
  const url = shareUrl(currentDocument())
  if (url.length > MAX_SHARE_URL) {
    error.value = `This shot carries ${(url.length / 1024).toFixed(0)}KB of layer data and the link would be truncated in transit. Export it as a project instead.`
    return
  }
  await navigator.clipboard.writeText(url)
  linkCopied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    linkCopied.value = false
  }, 1600)
}

/**
 * The project library.
 *
 * The working copy is still what is being edited, always. A project is a
 * snapshot of it under a name, so opening one replaces the working copy and
 * saving writes the working copy into it — the same two moves a file has in any
 * editor, with the "file" living in this browser and the export being the way it
 * becomes an actual one.
 */
const projectsOpen = ref(false)
const projects = ref<ProjectSummary[]>([])
/** Which project the working copy came from, so ⌘S has something to overwrite. */
const activeProjectId = ref<string | null>(null)
const ACTIVE_KEY = 'render-labs:project'
/** Serializes the library actions; they all touch the same database. */
const projectBusy = ref(false)

const activeProject = computed(() => projects.value.find(entry => entry.id === activeProjectId.value) ?? null)
const suggestedName = computed(() => activeProject.value?.name ?? takeSubject.value)
/** Room used and available for this site, refreshed whenever the library changes. */
const storage = ref<{ usage: number, quota: number } | null>(null)
const storagePersisted = ref(false)

/**
 * The frame on screen, small, as the project's picture.
 *
 * Taken from the live canvas rather than re-rendered: the shot is already
 * composited there, and asking the renderer for another frame would move the
 * clock. WebP because a poster is decoration — a quarter of the size of a PNG
 * and nothing here is looked at closely enough to notice.
 */
async function capturePoster(): Promise<Blob | undefined> {
  const source = canvas.value
  if (!source?.width) return undefined
  try {
    const width = 320
    const thumb = document.createElement('canvas')
    thumb.width = width
    thumb.height = Math.max(1, Math.round((width * source.height) / source.width))
    thumb.getContext('2d')?.drawImage(source, 0, 0, thumb.width, thumb.height)
    return await new Promise<Blob | undefined>(resolve =>
      thumb.toBlob(blob => resolve(blob ?? undefined), 'image/webp', 0.75),
    )
  } catch {
    // A poster is worth nothing next to the save it would otherwise fail.
    return undefined
  }
}

function setActiveProject(id: string | null) {
  activeProjectId.value = id
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Only affects which name the save field offers next time.
  }
}

async function refreshProjects() {
  projects.value = await listProjects()
  // A project deleted in another tab should not stay named in this one.
  if (activeProjectId.value && !projects.value.some(entry => entry.id === activeProjectId.value)) {
    setActiveProject(null)
  }
  storage.value = await storageEstimate()
}

/** Every library action, with the one error surface and the one busy flag. */
async function runProjectAction(action: () => Promise<void>) {
  if (projectBusy.value) return
  projectBusy.value = true
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    projectBusy.value = false
  }
}

function saveCurrentProject(name: string, overwrite: string | null) {
  void runProjectAction(async () => {
    const summary = await saveProject(name, currentDocument(), overwrite ?? undefined, await capturePoster())
    setActiveProject(summary.id)
    // Asked at the first save, which is the first moment there is something to
    // lose. Granted or not, the answer only changes what the footer says.
    storagePersisted.value = await persist()
    await refreshProjects()
  })
}

/**
 * Put a document on screen, whatever it came from.
 *
 * The launcher, opening a project and importing a file all land here, so the
 * things that have to happen alongside the swap — dropping the selection,
 * throwing away the cached plate, remounting the stage — are stated once rather
 * than remembered three times.
 */
function applyDocument(document: LabDocument) {
  mode.value = document.mode
  settings.value = document.settings
  layers.value = document.layers
  camera.value = document.camera
  selectedId.value = null
  launching.value = false
  // Everything staged is new, so nothing on screen belongs to it.
  invalidateStageMarkup()
  stageKey.value++
}

/**
 * Start something, from the launcher.
 *
 * A take opens on the default animation; a shot opens on nothing.
 *
 * The asymmetry is the point. A video is a thing made of clips, so the first
 * clip is the errand — starting with one is starting. A shot is very often a
 * photograph somebody is about to drop in, and handing them an animation they
 * did not ask for means deleting it before they can begin. An empty frame is
 * not a missing default here; it is the canvas, and it says what to put on it.
 *
 * Written to storage immediately, and that is not an optimisation: the launcher
 * only shows when there is no working copy, so a document that exists on screen
 * but not on disk sends the next reload straight back to the question.
 */
function startDocument(kind: LabMode) {
  cue('arrival')
  const document = createDocument(kind)
  if (kind === 'video' && DEFAULT_COMPONENT) {
    const first = createComponentLayer(DEFAULT_COMPONENT, 0, document.settings.timelineLength)
    awaitingFit.add(first.id)
    document.layers = [first]
  }
  applyDocument(document)
  setActiveProject(null)
  saveStored(document)
  void seekTo(0)
}

/**
 * Turn the document from one kind into the other.
 *
 * A conversion rather than a new document: the two kinds share every part of
 * the model, so this only changes which parts are being read. A shot carries
 * the spans it is ignoring and a take keeps its clips, which is what makes
 * going back and forth free rather than a decision.
 */
function setMode(kind: LabMode) {
  if (mode.value === kind) return
  mode.value = kind
  // A shot is taken at the instant the playhead is on; a take has to start
  // somewhere, and it is never part-way through.
  if (kind === 'video') void seekTo(0)
}

function openStoredProject(id: string) {
  void runProjectAction(async () => {
    const document = await openProject(id)
    if (!document) {
      error.value = 'That project could not be read.'
      return
    }
    applyDocument(document)
    setActiveProject(id)
    projectsOpen.value = false
    await seekTo(0)
  })
}

function exportStoredProject(id: string) {
  void runProjectAction(async () => {
    const entry = projects.value.find(project => project.id === id)
    const document = await openProject(id)
    if (!entry || !document) {
      error.value = 'That project could not be read.'
      return
    }
    download(await exportProject(entry.name, document, entry.poster), projectFilename(entry.name))
  })
}

function importProjectFile(file: File) {
  void runProjectAction(async () => {
    const { name, document, poster } = await importProject(file)
    // Saved on arrival rather than only opened: an imported file that is not in
    // the library is a project you cannot get back to once you edit over it.
    const summary = await saveProject(name, document, undefined, poster)
    await refreshProjects()
    openStoredProject(summary.id)
  })
}

function removeStoredProject(id: string) {
  void runProjectAction(async () => {
    await deleteProject(id, currentDocument())
    if (activeProjectId.value === id) setActiveProject(null)
    await refreshProjects()
  })
}

onMounted(async () => {
  try {
    activeProjectId.value = localStorage.getItem(ACTIVE_KEY)
  } catch {
    activeProjectId.value = null
  }
  storagePersisted.value = await navigator.storage?.persisted?.().catch(() => false) ?? false
  await refreshProjects()
  // Reclaim media no project and no working copy still points at — media
  // outlives the layer that imported it, and nothing else would ever free it.
  await sweepAssets(currentDocument()).catch(() => 0)
})

/** Wait on a real timer — the clock only patches rAF, so this survives virtual mode. */
function realDelay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Restart the staged component with the clock already virtual.
 *
 * The remount has to happen after `enterVirtual`, so the frames the component
 * schedules on mount land in the virtual queue. The delay is for the
 * IntersectionObserver that most of these components use to start themselves —
 * it fires on a real task, not on a frame.
 */
async function primeVirtualStage() {
  // Everything the export depends on is imposed here rather than inherited.
  // A take must be a function of the timeline alone: whatever the playhead was
  // doing, whichever frame was on screen, the file has to come out the same.
  playing.value = false

  // A scrub in flight drives the same clock, and its remaining steps would
  // interleave with the export's own.
  let waited = 0
  while (seeking.value && waited < 3000) {
    await realDelay(20)
    waited += 20
  }

  clock?.enterVirtual()
  replayedSignature = originSignature.value
  clock?.reset(stageOrigin.value)
  playhead.value = stageOrigin.value
  invalidateStageMarkup()
  stageKey.value++
  await nextTick()

  // Most staged components start themselves from an IntersectionObserver, which
  // fires on a real task. Until every one of them has, the first frames would
  // capture whichever happened to be ready.
  await realDelay(300)

  // Two settled frames: the first lets each component start, the second lets
  // whatever that started register before anything is captured.
  await clock?.advance(0)
  await clock?.advance(0)

  // Run the pre-roll off before frame one. Anything trimmed has to reach the
  // pose the cut left it in, and the take opens on that pose rather than on the
  // beginning of a sequence the timeline says was already over.
  await advanceToTime(0)

  await captureStage()
}

/**
 * How much larger than the output a still is rendered before being resolved down.
 *
 * The preview always looked better than the export, and the reason turned out to
 * be nothing in the pipeline: the canvas is displayed smaller than it is
 * rendered, so the browser was averaging the frame on its way to the screen.
 * That averaging is real anti-aliasing, and everything this thing makes is built
 * out of exactly the high-frequency detail it helps — cell edges, glyph strokes,
 * dither, grain, the ragged rim of a bokeh disc.
 *
 * So the export does it deliberately instead of the display doing it by
 * accident. Two is the whole of the useful range: it turns each output pixel
 * into an average of four, and past it the returns fall off far faster than the
 * fill rate does.
 */
const EXPORT_SUPERSAMPLE = 2

/**
 * Ceiling on the rendered edge, in pixels.
 *
 * Supersampling a 4K delivery would ask for an 8K buffer, which is past what a
 * good many drivers will allocate as a render target — and a still that fails to
 * export is worse than one that is merely not supersampled.
 */
const MAX_RENDER_EDGE = 4096

/**
 * One frame at the export size, as bytes.
 *
 * Rendered large, resolved down by the 2D context — a single downscale of an
 * exact power of two is a box filter, which is the correct resolve and is what
 * the GPU would do anyway.
 *
 * The renderer is put back to the preview size before this returns, so the frame
 * on screen does not stay stretched at the output resolution while a blob is
 * being encoded.
 */
async function renderPng(): Promise<Blob> {
  if (!renderer) throw new Error('The renderer is not ready.')
  const { outputWidth, outputHeight } = settings.value
  const scale = Math.max(1, Math.min(EXPORT_SUPERSAMPLE, MAX_RENDER_EDGE / Math.max(outputWidth, outputHeight)))

  try {
    renderer.resize(outputWidth * scale, outputHeight * scale)
    await captureStage()
    renderer.render(shotSettings.value, performance.now(), layerPlanes.value, overlayQuads.value)
    if (scale === 1) return await canvasToBlob(renderer.canvas)

    const resolved = document.createElement('canvas')
    resolved.width = outputWidth
    resolved.height = outputHeight
    const context = resolved.getContext('2d')
    if (!context) throw new Error('Failed to allocate a context to resolve the frame into.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(renderer.canvas, 0, 0, outputWidth, outputHeight)
    return await canvasToBlob(resolved)
  } finally {
    renderer.resize(previewSize.value.width, previewSize.value.height)
  }
}

async function exportPng() {
  if (!renderer || busy.value) return
  busy.value = true
  error.value = ''
  try {
    download(await renderPng(), takeName(takeSubject.value, 'png'))
    cue('success')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    cue('error')
  } finally {
    busy.value = false
  }
}

const pngCopied = ref(false)
let pngCopiedTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The frame straight onto the clipboard, for pasting rather than filing.
 *
 * The `ClipboardItem` is built around the pending blob rather than awaited
 * first, and that is the whole reason this works: writing to the clipboard needs
 * the user gesture that started it, and rendering a frame at the output size
 * takes long enough to lose it. Handed a promise, the browser keeps the gesture
 * alive until it settles.
 */
async function copyPng() {
  if (!renderer || busy.value) return
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    error.value = 'This browser cannot write images to the clipboard. Use the menu to download instead.'
    return
  }

  busy.value = true
  error.value = ''
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPng() })])
    // The shutter, on the one action that is literally taking a picture.
    cue('chime')
    pngCopied.value = true
    if (pngCopiedTimer) clearTimeout(pngCopiedTimer)
    pngCopiedTimer = setTimeout(() => {
      pngCopied.value = false
    }, 1600)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

let abort: AbortController | null = null

async function exportVideo() {
  if (!renderer || busy.value) return
  if (!isEncodingSupported()) {
    error.value = 'This browser cannot encode video. Chrome, Edge or Safari 16.4+ are needed.'
    return
  }

  busy.value = true
  progress.value = 0
  error.value = ''
  abort = new AbortController()

  const { fps, speed, container } = settings.value
  // Component milliseconds per output frame: a slower playback rate covers less
  // of the sequence per frame, which is what makes the export slow motion.
  const frameInterval = (1000 / fps) * speed
  const frameCount = frameCountFor(settings.value)

  try {
    await primeVirtualStage()
    renderer.resize(settings.value.outputWidth, settings.value.outputHeight)

    const blob = await encodeVideo({
      canvas: renderer.canvas,
      fps,
      frameCount,
      container: container as Container,
      signal: abort.signal,
      onProgress: (rendered, total) => {
        progress.value = rendered / total
      },
      renderFrame: async (index) => {
        // Frame 0 is the scene at t=0; every later frame is exactly one interval
        // on, regardless of how long the previous one took to build.
        await clock?.advance(index === 0 ? 0 : frameInterval)

        // The preview loop is stopped while exporting, so the playhead has to be
        // moved here. It is what every layer's span, fade and video frame is
        // read against — left behind, the whole take renders at time zero, and
        // anything that does not start at zero never appears at all.
        playhead.value = clock?.now ?? 0
        await nextTick()

        await captureStage()
        await syncVideoFrames(playhead.value, true)
        renderer?.render(shotSettings.value, clock?.now ?? 0, layerPlanes.value, overlayQuads.value)
      },
    })

    download(blob, takeName(takeSubject.value, container === 'mp4' ? 'mp4' : 'webm'))
  } catch (cause) {
    if ((cause as Error)?.name !== 'AbortError') {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    // Stay virtual. The preview runs on this clock too, so handing time back to
    // the real loop here would silently drop `speed` until the next reload.
    replayedSignature = originSignature.value
    clock?.reset(stageOrigin.value)
    invalidateStageMarkup()
    renderer.resize(previewSize.value.width, previewSize.value.height)
    lastCaptureAt = 0
    lastFrameAt = 0
    frameDebt = 0
    busy.value = false
    abort = null
    void seekTo(0)
  }
}

function cancelExport() {
  abort?.abort()
}

/**
 * Camera gestures on the frame itself. Disabled while the focus picker is armed,
 * so that click means "focus here" and nothing else.
 */
const panel = useResizable({ key: 'panel-width', initial: 290, min: 240, max: 560, axis: 'x' })
const dock = useResizable({ key: 'timeline-height', initial: 232, min: 140, max: 520, axis: 'y' })

const gestures = useCameraGestures(
  editorShotSettings,
  // Never while a layer is being dragged: one pointer, and whichever gesture
  // claimed it keeps it. Orbiting the camera under a layer being placed would
  // move the thing and the frame it is being placed against at once.
  () => !picking.value && !busy.value && !layerGestures.active.value,
  () => renderer?.distanceFor(shotSettings.value) ?? 1,
)

const layerGestures = useLayerGestures({
  settings,
  worldPerFrame: depth => renderer?.worldPerFrame(shotSettings.value, depth) ?? null,
  stageAspect,
  apply: (id, patch) => updateLayer(id, patch),
})

/**
 * The selected layer's outline on the frame, or null when there is nothing to
 * draw one around.
 *
 * Recomputed from the same plane the renderer is about to draw, so the box
 * cannot drift from the picture: every input it takes — the camera, the layer's
 * placement, the instant — is already a dependency of that plane.
 */
const selectionCorners = computed<[number, number][] | null>(() => {
  const layer = selectedLayer.value
  if (!layer || !renderer) return null

  if (layer.space === 'overlay') {
    const quad = overlayQuads.value.find(entry => entry.id === layer.id)
    if (!quad) return null
    // Overlays are already frame fractions; only the y axis has to be turned
    // over, because the frame runs down and the renderer's overlay runs up.
    const left = quad.x - quad.halfWidth
    const right = quad.x + quad.halfWidth
    const top = 1 - (quad.y + quad.halfHeight)
    const bottom = 1 - (quad.y - quad.halfHeight)
    return [[left, top], [right, top], [right, bottom], [left, bottom]]
  }

  const plane = layerPlanes.value.find(entry => entry.id === layer.id)
  return plane ? renderer.projectPlane(shotSettings.value, plane) : null
})

const selectionCentre = computed(() => {
  const corners = selectionCorners.value
  if (!corners?.length) return null
  const sum = corners.reduce(([x, y], [cx, cy]) => [x + cx, y + cy], [0, 0])
  return { x: sum[0] / corners.length, y: sum[1] / corners.length }
})

/**
 * Which layer a point on the frame lands on, topmost first.
 *
 * Tested against the projected outline rather than against a rectangle, so a
 * tilted layer is grabbed where it looks like it is. Reversed because the last
 * layer in the list is drawn over the others, and clicking a stack has to reach
 * the one on top.
 */
function layerAt(point: { x: number, y: number }): Layer | null {
  for (let index = layers.value.length - 1; index >= 0; index--) {
    const layer = layers.value[index]
    if (!layer || !renderer) continue
    const corners = cornersFor(layer)
    if (corners && containsPoint(corners, point)) return layer
  }
  return null
}

function cornersFor(layer: Layer): [number, number][] | null {
  if (layer.space === 'overlay') {
    const quad = overlayQuads.value.find(entry => entry.id === layer.id)
    if (!quad) return null
    const left = quad.x - quad.halfWidth
    const right = quad.x + quad.halfWidth
    const top = 1 - (quad.y + quad.halfHeight)
    const bottom = 1 - (quad.y - quad.halfHeight)
    return [[left, top], [right, top], [right, bottom], [left, bottom]]
  }
  const plane = layerPlanes.value.find(entry => entry.id === layer.id)
  return plane && renderer ? renderer.projectPlane(shotSettings.value, plane) : null
}

/** Winding test over a convex quad — every cross product on the same side. */
function containsPoint(corners: [number, number][], point: { x: number, y: number }): boolean {
  let sign = 0
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index]!
    const b = corners[(index + 1) % corners.length]!
    const cross = (b[0] - a[0]) * (point.y - a[1]) - (b[1] - a[1]) * (point.x - a[0])
    if (Math.abs(cross) < 1e-9) continue
    const side = cross > 0 ? 1 : -1
    if (sign === 0) sign = side
    else if (side !== sign) return false
  }
  return true
}

/**
 * A press on the frame: take the layer under it, or hand the drag to the camera.
 *
 * Selecting and starting to move are the same gesture on purpose. Requiring a
 * click to select and then a second drag to move is the interaction every
 * canvas tool abandoned years ago, and it costs a round trip on every single
 * placement.
 */
function onFramePointerDown(event: PointerEvent) {
  if (picking.value || busy.value) return
  // The instruments sit inside the frame, and this handler is on the frame. A
  // press on one of them was being read as a press on the picture behind it,
  // which took the pointer capture the button needed to receive its own click —
  // so the guides and the reticle simply stopped toggling.
  if (event.target !== canvas.value) return
  const element = event.currentTarget as HTMLElement
  const point = framePointAt(event, element)
  const hit = layerAt(point)

  if (!hit) {
    selectedId.value = null
    gestures.onPointerDown(event)
    return
  }

  selectedId.value = hit.id
  const centre = selectionCentre.value ?? point
  layerGestures.begin(hit, { kind: 'move' }, point, centre)
  element.setPointerCapture(event.pointerId)
}

function onFrameGrab(grab: LayerGrab, event: PointerEvent) {
  const layer = selectedLayer.value
  const centre = selectionCentre.value
  const element = frame.value
  if (!layer || !centre || !element) return
  layerGestures.begin(layer, grab, framePointAt(event, element), centre)
  element.setPointerCapture(event.pointerId)
}

/** True while files are being dragged over the frame, for the drop affordance. */
const dropping = ref(false)

/**
 * Files dropped straight onto the picture.
 *
 * The timeline already accepted a drop, which is the right place in a take —
 * you are dropping a clip at a time. A shot has no timeline, and the frame is
 * the only thing on screen to aim at, so it has to be a target too.
 */
function onFrameDrop(event: DragEvent) {
  dropping.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (!files.length) return
  cue('droplet')
  void importFiles(files, playhead.value)
}

function onFramePointerUp(event: PointerEvent) {
  if (layerGestures.active.value) {
    layerGestures.end()
    return
  }
  gestures.onPointerUp(event)
}

defineShortcuts({
  r: replay,
  h: () => {
    panelVisible.value = !panelVisible.value
  },
  g: () => {
    guides.value = !guides.value
  },
})

// Space is the universal transport key and is not something `defineShortcuts`
// covers; it also has to be stopped from scrolling or re-triggering a button.
function onKeydown(event: KeyboardEvent) {
  if (event.repeat) return
  const target = event.target as HTMLElement | null
  // Never steal a key from a field someone is typing in.
  if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return

  const accel = event.metaKey || event.ctrlKey
  // `key` carries the shifted character, so ⌘⇧Z arrives as `Z`. Folded for the
  // single-character keys only — the named ones are already stable, and lowering
  // them turns `ArrowLeft` into a string nothing below matches.
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  if (accel && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  // The other half of the pair on Windows and Linux, where ⇧ is not how redo is
  // spelled.
  if (accel && key === 'y') {
    event.preventDefault()
    redo()
    return
  }
  // The file keys, where a browser has nothing useful to offer a page like this
  // one: ⌘S would save the app shell as HTML, ⌘O would open a file picker with
  // no idea what to do with the result.
  if (accel && key === 's') {
    event.preventDefault()
    // Straight to the project it came from. Without one there is nothing to
    // overwrite, so it asks for a name instead.
    if (activeProjectId.value) saveCurrentProject(suggestedName.value, activeProjectId.value)
    else projectsOpen.value = true
    return
  }
  if (accel && key === 'o') {
    event.preventDefault()
    projectsOpen.value = !projectsOpen.value
    return
  }
  if (accel && key === 'c') {
    copySelected()
    return
  }
  if (accel && key === 'v') {
    event.preventDefault()
    pasteClipboard()
    return
  }
  if (accel && key === 'd') {
    event.preventDefault()
    duplicateSelected()
    return
  }
  if (!accel && (key === 'Delete' || key === 'Backspace') && selectedId.value) {
    event.preventDefault()
    removeSelected()
    return
  }
  if (!accel && key === 'Escape') {
    // Escape puts things back rather than just closing them: a focus racked
    // while hunting for the right plane is a change nobody committed to.
    if (picking.value) cancelPicking()
    else if (projectsOpen.value) projectsOpen.value = false
    else if (shortcutsOpen.value) shortcutsOpen.value = false
    else selectedId.value = null
    return
  }
  if (event.code === 'Space') {
    event.preventDefault()
    togglePlay()
    return
  }

  // Frame stepping, the way every editor does it. Holding shift moves ten,
  // which is what you reach for when hunting for a moment rather than a frame.
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    playing.value = false
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const step = frameStep(settings.value) * (event.shiftKey ? 10 : 1)
    void seekTo(playhead.value + direction * step)
    return
  }
  if (key === 'Home') {
    event.preventDefault()
    playing.value = false
    void seekTo(0)
    return
  }
  if (key === 'End') {
    event.preventDefault()
    playing.value = false
    void seekTo(settings.value.timelineLength)
    return
  }
  // Every bare letter below is guarded against the accelerator. Unguarded, the
  // browser's own ⌘S reached the razor and cut the selected clip in half on the
  // way to a save dialog the page does not even use.
  if (!accel && key === 'z') {
    timeline.value?.fitView()
    return
  }
  // The razor. `C` is where the hand goes — it is the blade in Premiere and in
  // Resolve; `S` stays bound because it was, and unlearning a key nobody asked
  // to lose is a worse trade than carrying two.
  if (!accel && (key === 'c' || key === 's') && selectedId.value) {
    splitLayer(selectedId.value)
    return
  }
  if (!accel && key === 'j' && selectedId.value) {
    joinLayer(selectedId.value)
    return
  }
  if (!accel && key === '?') {
    event.preventDefault()
    shortcutsOpen.value = !shortcutsOpen.value
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!--
    `lab-chrome` is what carries the theme, and `data-theme` is what picks it.
    Every colour token the tool draws itself in is scoped to this pair rather
    than to `<html>`, so the theme stops at the edge of the tool — see
    `assets/css/main.css` and `composables/useLabTheme.ts`, and the stage below,
    which is deliberately not inside it.
  -->
  <div
    ref="chrome"
    class="lab-chrome fixed inset-0 flex overflow-hidden bg-default"
    :data-theme="isDark ? 'dark' : 'light'"
  >
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- The margin around the frame is empty space too, and clears the selection. -->
      <main
        class="relative flex min-h-0 flex-1 items-center justify-center p-8"
        @pointerdown.self="selectedId = null"
      >
        <!--
          The pointer is arbitrated here rather than on the canvas, because a
          drag that starts on a layer has to keep receiving moves after it
          leaves that layer — and the handles sit outside the canvas element.
        -->
        <div
          ref="frame"
          class="relative max-h-full max-w-full"
          :style="{ aspectRatio: `${settings.outputWidth} / ${settings.outputHeight}` }"
          @dragover.prevent="dropping = true"
          @dragleave="dropping = false"
          @drop.prevent="onFrameDrop"
          @pointerdown="onFramePointerDown"
          @pointermove="onFramePointer($event); onFocusHover($event); gestures.onPointerMove($event)"
          @pointerup="onFramePointerUp"
          @pointercancel="onFramePointerUp"
          @pointerleave="framePointer = null"
        >
          <canvas
            ref="canvas"
            class="block h-full w-full touch-none border border-default"
            :class="picking
              ? 'cursor-crosshair border-primary-500/50'
              : layerGestures.active.value
                ? 'cursor-grabbing'
                : gestures.active.value ? 'cursor-grabbing' : 'cursor-grab'"
            @click="onFrameClick"
            @wheel="gestures.onWheel"
          />

          <!--
            Only while there is a selection and nothing else owns the pointer.
            Handles over a frame being focused would take the click the reticle
            exists to receive.
          -->
          <LabHandles
            v-if="selectionCorners && !picking"
            :corners="selectionCorners"
            @grab-corner="(index, event) => onFrameGrab({ kind: 'resize', corner: index }, event)"
            @grab-rotate="event => onFrameGrab({ kind: 'rotate' }, event)"
          />
          <LabGuides
            v-if="guides"
            :width="settings.outputWidth"
            :height="settings.outputHeight"
          />

          <!--
            The empty canvas, which is a state a shot now opens in on purpose.
            A black rectangle with no affordance reads as something that failed
            to load; the same rectangle saying what goes on it is the start of
            the job. Gone the moment there is a layer, because from then on the
            frame is the picture and anything over it is in the way.
          -->
          <div
            v-if="!layers.length"
            class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 border border-dashed transition-colors"
            :class="dropping ? 'border-blue-400/80 bg-blue-500/10' : 'border-white/15'"
          >
            <p class="font-mono text-[11px] text-white/45">
              Drop an image or a video here
            </p>
            <div class="pointer-events-auto flex items-center gap-1">
              <button
                type="button"
                data-cuelume-press
                class="border border-white/15 bg-black/40 px-2.5 py-1 font-mono text-[10px] text-white/60 transition-colors hover:border-white/35 hover:text-white/90"
                @click="addMedia"
              >
                choose a file
              </button>
              <button
                type="button"
                data-cuelume-press
                class="border border-white/15 bg-black/40 px-2.5 py-1 font-mono text-[10px] text-white/60 transition-colors hover:border-white/35 hover:text-white/90"
                @click="addComponent"
              >
                stage a component
              </button>
            </div>
          </div>

          <!--
            From here to the end of the frame, the colours are literal and stay
            that way. Everything inside this box is drawn over the picture, and
            the picture's background is a setting rather than a theme — putting
            the panel in a light theme does not turn the shot white, so an
            instrument that followed the panel would vanish against the thing it
            is pointing at.
          -->
          <!--
            The reticle belongs to the act of focusing, not to the guides.
            Two lines across the whole frame said nothing about what they were
            for and were on whether or not anyone had asked. Focusing is a
            question about one spot, so the instrument is a small target that
            rides the pointer and says what clicking will do.
          -->
          <div
            v-if="picking && framePointer"
            class="pointer-events-none absolute size-14 -translate-x-1/2 -translate-y-1/2"
            :style="{ left: `${framePointer.x * 100}%`, top: `${framePointer.y * 100}%` }"
          >
            <div class="absolute inset-0 rounded-full border border-blue-400/80" />
            <div class="absolute inset-[38%] rounded-full bg-blue-400/80" />
            <div class="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-blue-400/80" />
            <div class="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-blue-400/80" />
            <div class="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-blue-400/80" />
            <div class="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-blue-400/80" />
            <span class="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[2px] bg-blue-500 px-1.5 py-px font-mono text-[9px] leading-tight text-white">
              focus here
            </span>
          </div>

          <!--
            The instruments, gathered where they act.
            Both of these change what the frame shows rather than what it
            contains, so they live on the frame instead of down a section of the
            panel — and being visible is how anyone finds out they exist.
          -->
          <!--
            Opposite the instruments and clear of the middle. It is a compass,
            and a compass belongs in a corner rather than over the thing you are
            trying to look at.
          -->
          <div
            v-if="gizmo"
            class="absolute right-2 top-2"
          >
            <LabGizmo
              :pitch="editorShotSettings.pitch"
              :yaw="editorShotSettings.yaw"
              :roll="editorShotSettings.roll"
              @snap="snapCamera"
            />
          </div>

          <div class="absolute left-2 top-2 flex flex-col gap-1">
            <button
              v-for="tool in [
                { key: 'guides', icon: 'i-lucide-grid-2x2', label: 'Guides, safe area and rulers (G)', on: guides },
                { key: 'gizmo', icon: 'i-lucide-axis-3d', label: 'Which way the camera is pointing', on: gizmo },
                { key: 'focus', icon: 'i-lucide-crosshair', label: 'Click a spot in the frame to focus on it', on: picking },
              ]"
              :key="tool.key"
              type="button"
              data-cuelume-toggle
              class="flex size-6 items-center justify-center border backdrop-blur-[2px] transition-colors"
              :class="tool.on
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                : 'border-white/10 bg-black/40 text-white/45 hover:border-white/25 hover:text-white/90'"
              :title="tool.label"
              @click="tool.key === 'guides'
                ? (guides = !guides)
                : tool.key === 'gizmo'
                  ? (gizmo = !gizmo)
                  : (picking ? cancelPicking() : (picking = true))"
            >
              <UIcon :name="tool.icon" class="size-3.5" />
            </button>
          </div>
        </div>

        <div class="pointer-events-none absolute bottom-4 left-4 font-mono text-[10px] text-dimmed/55">
          <template v-if="picking">
            focus follows the reticle · click to keep it · esc to put it back
          </template>
          <template v-else>
            <!-- The open project first: it is the only part of this line that
                 changes what a save will overwrite. -->
            <span v-if="activeProject" class="text-muted">{{ activeProject.name }}</span>
            <span v-else class="text-dimmed/70">unsaved</span>
            · {{ settings.outputWidth }}×{{ settings.outputHeight }} · {{ layers.length }} layers · g guides · h panels · ⌘o projects · ? keys
          </template>
        </div>

        <p
          v-if="error"
          class="absolute left-4 top-4 max-w-md border border-error/30 bg-error/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-error"
        >
          {{ error }}
        </p>
      </main>

      <!--
        Grab edge for the timeline's height.
        A hairline to look at, six pixels to hit. The two do not have to be the
        same thing, and making them so forces a choice between a border thick
        enough to read as a divider and a target thin enough to be fiddly.
      -->
      <div
        v-show="panelVisible && mode === 'video'"
        class="group/split relative h-1.5 shrink-0 cursor-ns-resize"
        @pointerdown="dock.onPointerDown"
      >
        <div
          class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors"
          :class="dock.dragging.value ? 'bg-primary-500' : 'bg-border group-hover/split:bg-primary-500/60'"
        />
      </div>
      <LabShotBar
        v-if="mode === 'shot'"
        v-show="panelVisible"
        :layers
        :selected-id
        :moment="playhead"
        :length="settings.timelineLength"
        :has-component="Boolean(componentLayers.length)"
        @seek="onScrub"
        @select="selectedId = $event"
        @add-text="addText"
        @add-image="addMedia"
        @remove="selectedId = $event; removeSelected()"
      />
      <LabTimeline
        v-if="mode === 'video'"
        v-show="panelVisible"
        ref="timeline"
        v-model:layers="layers"
        :style="{ height: `${dock.size.value}px` }"
        :playhead
        :length="settings.timelineLength"
        :playing
        :seeking
        :output-ms
        :frames="frameCount"
        :fps="settings.fps"
        :selected-id
        @scrub="onScrub"
        @scrub-start="scrubDragging = true"
        @scrub-end="endScrub"
        @join="joinLayer"
        @reorder="reorderLayers"
        @toggle-play="togglePlay"
        @select="selectedId = $event"
        @add-text="addText"
        @add-image="addMedia"
        @add-component="addComponent"
        @drop-files="importFiles"
        @duplicate="selectedId = $event; duplicateSelected()"
        @copy="copyLayer"
        @paste="pasteClipboard"
        @split="splitLayer"
        @remove="selectedId = $event; removeSelected()"
      />
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/svg+xml,image/webp,video/mp4,video/webm,video/quicktime"
      multiple
      class="hidden"
      @change="onImagePicked"
    >

    <!-- Grab edge for the panel's width, on the same hairline-and-hit-zone terms. -->
    <div
      v-show="panelVisible"
      class="group/split relative w-1.5 shrink-0 cursor-ew-resize"
      @pointerdown="panel.onPointerDown"
    >
      <div
        class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors"
        :class="panel.dragging.value ? 'bg-primary-500' : 'bg-border group-hover/split:bg-primary-500/60'"
      />
    </div>
    <!--
      Over everything, including the panel: until a document exists there is
      nothing for those controls to act on, and a panel full of live sliders
      beside a question that has not been answered invites you to grade a shot
      that is not there.
    -->
    <LabLauncher
      v-if="launching"
      :recent="projects"
      :dismissable="layers.length > 0"
      @create="startDocument"
      @open="openStoredProject"
      @browse="launching = false; projectsOpen = true"
      @dismiss="launching = false"
    />

    <LabShortcuts v-model="shortcutsOpen" />

    <LabProjects
      v-model="projectsOpen"
      :projects
      :active-id="activeProjectId"
      :suggested-name
      :busy="projectBusy"
      :storage
      :persisted="storagePersisted"
      @save="saveCurrentProject"
      @open-project="openStoredProject"
      @rename="(id, name) => runProjectAction(async () => { await renameProject(id, name); await refreshProjects() })"
      @duplicate="(id) => runProjectAction(async () => { await duplicateProject(id); await refreshProjects() })"
      @remove="removeStoredProject"
      @export-project="exportStoredProject"
      @import-file="importProjectFile"
    />

    <LabPanel
      v-show="panelVisible"
      v-model:settings="settings"
      v-model:picking="picking"
      v-model:camera="editorCamera"
      :style="{ width: `${panel.size.value}px` }"
      :mode
      :cues-enabled
      :layers
      :selected-layer-id="selectedId"
      :link-copied
      :busy
      :progress
      :high-precision
      :capture-ms
      :selected-layer
      :shot-settings="editorShotSettings"
      :shot-customized="selectedShotCustomized"
      :sequence-ms="selectedSequenceMs"
      :can-undo
      :can-redo
      :png-copied
      @undo="undo"
      @redo="redo"
      @update-layer="updateLayer"
      @update-shot-setting="updateShotSetting"
      @reset-shot="resetSelectedShot"
      @remove-layer="removeSelected"
      @duplicate-layer="duplicateSelected"
      @fit="resetCamera"
      @fit-stage="fitStage"
      @replay="replay"
      @export-video="exportVideo"
      @export-png="exportPng"
      @copy-png="copyPng"
      @new-document="launching = true"
      @set-mode="setMode"
      @select-layer="selectedId = $event"
      @shift-layer="shiftLayer"
      @remove-layer-by-id="selectedId = $event; removeSelected()"
      @add-image="addMedia"
      @add-text="addText"
      @set-cues="setCuesEnabled"
      @copy-link="copyLink"
      @shortcuts="shortcutsOpen = true"
      @projects="projectsOpen = true"
      @reset-settings="resetSettings"
      @reset-everything="resetEverything"
      @cancel="cancelExport"
    />
  </div>

  <!--
    The live stage. It has to be genuinely on screen and not display:none —
    most of these components start themselves from an IntersectionObserver,
    which reports nothing for a hidden element. So it sits pinned behind the
    UI at near-zero opacity, where it lays out and animates normally.
  -->
  <!--
    Outside `lab-chrome`, and carrying no theme of its own.

    Being outside is what stops the tool's theme from reaching the thing being
    filmed: these components are the site's, drawn with the site's tokens, and a
    plate rasterized under the panel's variables would come out in the lab's
    colours instead of the site's. It is `position: fixed`, so lifting it out of
    the flex row costs nothing in layout.

    Carrying nothing is the other half, and it is the half that is easy to get
    wrong. Putting `dark` here to shield it looks like the safe move and is not:
    a class on the element wins over a value inherited from `:root`, so the
    source stylesheet's `--ui-bg: zinc-950` lost to Nuxt UI's default `.dark`
    block and every export came out a step lighter than the site. The stage
    inherits from `<html>`, which stays dark, and the panel's theme never enters
    the room.
  -->
  <div
    ref="stagesRoot"
    data-lab-stage
    class="pointer-events-none fixed left-0 top-0 z-0 opacity-[0.002]"
  >
    <!--
      Each instance is mounted at its clip's origin, not at the top of the
      take. Mounting is what starts these components, so the moment it happens
      is the moment their sequence begins — which is how a trimmed clip shows
      its source part-way through instead of replaying it from the beginning.
    -->
    <!--
      Every stage occupies the same corner, one on top of another.
      They used to stack down the page, which put the second one below the fold
      of a normal window — and these components start themselves from an
      IntersectionObserver at a 20% threshold. A clip whose stage was off screen
      therefore never started: its plate stayed on the initial state, and the
      take went blank for exactly the span of that clip. Capture reads each
      stage by element, not by what is painted, so overlapping costs nothing —
      and it means clip five sits precisely where clip one does, which is the
      only position known to be visible.
    -->
    <div
      v-for="staged in stagedComponents"
      :key="staged.layer.id"
      :data-stage="staged.layer.id"
      :data-stage-speed="layerSpeed(staged.layer)"
      class="absolute left-0 top-0 overflow-hidden bg-default"
      :style="{
        width: `${settings.stageWidth}px`,
        height: `${settings.stageHeight}px`,
        zIndex: isLive(staged.layer) ? 1 : 0,
      }"
    >
      <LabStage :layer-id="staged.layer.id" :speed="layerSpeed(staged.layer)">
        <component
          :is="staged.component"
          v-if="staged.component && playhead >= layerOrigin(staged.layer)"
          :key="`${stageKey}:${layerOrigin(staged.layer)}:${layerSpeed(staged.layer)}`"
        />
      </LabStage>
    </div>
  </div>
</template>
