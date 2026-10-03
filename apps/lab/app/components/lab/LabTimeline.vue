<script setup lang="ts">
/**
 * The take, laid out in time.
 *
 * Scrubbing turns a looping animation into something that can be inspected: a
 * frame can be held still and graded, and the interesting two seconds of a six
 * second sequence can be picked out instead of exporting all of it and trimming
 * it afterwards in another tool.
 *
 * The ruler is in component time — the clock the staged animation runs on — not
 * output time. Those differ whenever playback speed is not 1, and a segment has
 * to be chosen against what the component is doing, not against how long the
 * file will end up being.
 *
 * Every grab target is drawn. An invisible hit zone that only announces itself
 * by changing the cursor makes a timeline feel broken: the pointer flickers
 * between shapes with nothing on screen to explain why.
 */

import { effectRampMs } from '~/utils/lab/effects'
import { canChangeLayerSpeed, canJoin, layerEnd, layerSpeed } from '~/utils/lab/layers'
import type { Layer } from '~/utils/lab/layers'

const props = defineProps<{
  playhead: number
  length: number
  playing: boolean
  /** True while a seek is in flight, so the playhead can show it is catching up. */
  seeking: boolean
  outputMs: number
  frames: number
  fps: number
  selectedId: string | null
}>()

const emit = defineEmits<{
  scrub: [ms: number]
  scrubStart: []
  scrubEnd: []
  join: [id: string]
  reorder: [from: number, to: number]
  togglePlay: []
  select: [id: string | null]
  addText: []
  addImage: []
  addComponent: []
  duplicate: [id: string]
  copy: [id: string]
  paste: []
  split: [id: string]
  remove: [id: string]
  dropFiles: [files: File[], atMs: number]
}>()

const layers = defineModel<Layer[]>('layers', { required: true })

// Teleported to `body`, which is outside `.lab-chrome` where the theme's tokens
// live — so the overlay has to carry the scope with it or it draws itself in the
// document's colours, which are the stage's and are always dark. See
// `useLabTheme`.
const { isDark } = useLabTheme()

/**
 * Ramp widths per clip, as CSS lengths, or null where the clip cuts.
 *
 * Resolved once per change rather than in the row: a track redraws on every
 * pointer move of a drag, and each clip would otherwise walk its effects four
 * times over — twice to ask whether to draw, twice to ask how wide.
 */
const ramps = computed(() => new Map(layers.value.map((layer) => {
  const width = (at: 'in' | 'out') => {
    const ms = effectRampMs(layer.effects, at)
    return ms > 0 ? `${Math.min(100, (ms / Math.max(layer.duration, 1)) * 100)}%` : null
  }
  return [layer.id, { in: width('in'), out: width('out') }]
})))

const ruler = useTemplateRef('ruler')

/** Shortest gap between the two trim handles, so they can always be told apart. */
const MIN_SEGMENT = 100
/** Snap radius in ms, scaled below so it stays a constant distance on screen. */
const SNAP_PIXELS = 6

type Drag =
  | { kind: 'playhead' }
  | { kind: 'clip', id: string, grab: 'body' | 'start' | 'end', offset: number }

const drag = ref<Drag | null>(null)
const hoveredId = ref<string | null>(null)

/** Where the pointer has put the playhead, ahead of the picture catching up. */
const scrubbing = ref<number | null>(null)

/** Row height, which is what a vertical drag is measured in. */
const ROW = 32

/**
 * A track being moved up or down the stack.
 *
 * `dy` is the raw pointer travel and `to` is the slot it currently belongs in.
 * Both are needed: the row being dragged follows the finger exactly, while the
 * rows it displaces move by whole slots.
 */
const stackDrag = ref<{ id: string, from: number, to: number, y: number, dy: number, lifted: boolean } | null>(null)

/** Travel before a press becomes a drag, so a click can still just select. */
const LIFT_THRESHOLD = 4

function onStackDown(event: PointerEvent, layer: Layer, index: number) {
  if (event.button !== 0) return
  emit('select', layer.id)
  stackDrag.value = { id: layer.id, from: index, to: index, y: event.clientY, dy: 0, lifted: false }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onStackMove(event: PointerEvent) {
  const current = stackDrag.value
  if (!current) return
  const dy = event.clientY - current.y
  if (!current.lifted && Math.abs(dy) <= LIFT_THRESHOLD) return

  const last = layers.value.length - 1
  stackDrag.value = {
    ...current,
    lifted: true,
    // Bounded by the list: a row cannot be dragged out of the stack, and the
    // rubber-band that would let it try only makes the drop ambiguous.
    dy: Math.max(-current.from * ROW, Math.min(dy, (last - current.from) * ROW)),
    to: Math.max(0, Math.min(current.from + Math.round(dy / ROW), last)),
  }
}

function onStackUp(event: PointerEvent) {
  const current = stackDrag.value
  if (!current) return
  stackDrag.value = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  // A press that never lifted is a click, and a click on a name selects it —
  // which pointerdown has already done.
  if (current.lifted && current.to !== current.from) emit('reorder', current.from, current.to)
}

/**
 * How far a row has moved while the stack is being reordered.
 *
 * The list rearranges itself under the pointer rather than announcing where the
 * row will land: the dragged row follows the finger, and everything it passes
 * steps aside by exactly one slot. A drop line asks you to picture the result;
 * this shows it, so the gap under the row you are holding is the answer.
 */
function stackShift(index: number): number {
  const current = stackDrag.value
  if (!current || !current.lifted) return 0
  if (index === current.from) return current.dy
  if (current.to > current.from && index > current.from && index <= current.to) return -ROW
  if (current.to < current.from && index >= current.to && index < current.from) return ROW
  return 0
}

/** True for the row under the hand, which must not lag behind it. */
function isLifted(index: number): boolean {
  return stackDrag.value?.lifted === true && stackDrag.value.from === index
}

/** Right-click menu, anchored where the click landed. */
const menu = ref<{ x: number, y: number, id: string } | null>(null)
const mediaMenu = ref(false)
const mediaButton = useTemplateRef('mediaButton')
/** Viewport position of the menu's bottom-right corner, measured on open. */
const mediaMenuAt = ref<{ x: number, y: number } | null>(null)

function toggleMediaMenu() {
  if (mediaMenu.value) {
    mediaMenu.value = false
    return
  }
  const box = mediaButton.value?.getBoundingClientRect()
  if (!box) return
  // Measured at the moment of opening rather than tracked: the timeline can be
  // resized and scrolled, but not while this menu is up.
  mediaMenuAt.value = { x: box.right, y: box.top - 4 }
  mediaMenu.value = true
}
const menuEl = useTemplateRef('menuEl')

/**
 * Keep the menu on screen.
 *
 * The timeline sits at the bottom of the window, so a menu opened downwards from
 * a clip runs straight off the edge — which is where this one was landing. It is
 * measured after mounting and flipped rather than sized by guesswork.
 */
async function openMenu(event: MouseEvent, layer: Layer) {
  emit('select', layer.id)
  menu.value = { x: event.clientX, y: event.clientY, id: layer.id }

  await nextTick()
  const box = menuEl.value?.getBoundingClientRect()
  if (!box || !menu.value) return

  const margin = 8
  let { x, y } = menu.value
  if (y + box.height > window.innerHeight - margin) y = Math.max(margin, y - box.height)
  if (x + box.width > window.innerWidth - margin) x = Math.max(margin, x - box.width)
  menu.value = { ...menu.value, x, y }
}

function closeMenu() {
  menu.value = null
  mediaMenu.value = false
}

/** True when the playhead falls inside the clip, which is what split needs. */
const canSplit = computed(() => {
  const layer = layers.value.find(entry => entry.id === menu.value?.id)
  if (!layer) return false
  return props.playhead > layer.start + MIN_SEGMENT && props.playhead < layerEnd(layer) - MIN_SEGMENT
})

/** True when the clip under the menu has a neighbour it can be put back together with. */
const canRejoin = computed(() => {
  const layer = layers.value.find(entry => entry.id === menu.value?.id)
  if (!layer) return false
  return layers.value.some(other => other.id !== layer.id && (canJoin(layer, other) || canJoin(other, layer)))
})

function run(action: 'duplicate' | 'copy' | 'split' | 'join' | 'remove') {
  const id = menu.value?.id
  closeMenu()
  if (!id) return
  emit(action, id)
}

onMounted(() => window.addEventListener('pointerdown', closeMenu))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeMenu))

/**
 * The ruler runs past the end of the take.
 *
 * The timeline is exactly as long as its content, so without headroom every
 * clip ends flush against the right edge and there is nowhere to drag it to
 * make it longer. The spare quarter is scrubbing and editing room, not part of
 * the export — the shaded band marks where the take actually stops.
 */
const HEADROOM = 1.25
/** Floor for that headroom, so a short take still has room to drag into. */
const MIN_HEADROOM = 3000

/** Everything that exists in time, take plus editing room. */
const content = computed(() => Math.max(1, props.length * HEADROOM, props.length + MIN_HEADROOM))

/**
 * The visible window onto the timeline.
 *
 * A fixed view is fine until a clip needs trimming to the frame: at six seconds
 * across a panel, one frame is under a pixel and no amount of care lands it.
 * `zoom` is how many times into the content we are, `offset` is where that
 * window starts — the same model every editor uses, because it is the only one
 * that lets you work at both scales.
 */
const zoom = ref(1)
const offset = ref(0)

const MAX_ZOOM = 60

/** Duration the panel currently shows. */
const span = computed(() => content.value / zoom.value)

function clampOffset(value: number) {
  return Math.max(0, Math.min(value, content.value - span.value))
}

watch(content, () => {
  offset.value = clampOffset(offset.value)
})

function percent(ms: number) {
  return ((ms - offset.value) / span.value) * 100
}

/** The playhead's position in the window, following the pointer while scrubbing. */
const headAt = computed(() => percent(scrubbing.value ?? props.playhead))

/** Pan the window back onto the playhead, leaving it a little off the edge. */
function revealPlayhead() {
  offset.value = clampOffset(props.playhead - span.value * 0.15)
}

/**
 * Keep the playhead in view.
 *
 * Zoomed in, the window covers a fraction of the take, so playing or stepping
 * walks the marker straight off the edge and leaves you scrolling after it. It
 * pans by whole windows rather than centring on every frame: a view that slides
 * continuously under a still marker is much harder to read than one that turns
 * a page.
 */
watch(() => props.playhead, (at) => {
  if (drag.value || zoom.value <= 1.001) return
  const margin = span.value * 0.05
  if (at >= offset.value + margin && at <= offset.value + span.value - margin) return
  offset.value = clampOffset(at - span.value * 0.15)
})

/** True when a time is far enough outside the window to skip drawing. */
function offscreen(ms: number) {
  const at = percent(ms)
  return at < -50 || at > 150
}

function trackWidth(): number {
  return ruler.value?.getBoundingClientRect().width || 1
}

function msAtClientX(clientX: number): number {
  const rect = ruler.value?.getBoundingClientRect()
  if (!rect?.width) return 0
  const ratio = (clientX - rect.left) / rect.width
  return offset.value + ratio * span.value
}

/**
 * Zoom around the pointer, pan with shift.
 *
 * Anchoring on the pointer is what makes zooming feel like moving a lens rather
 * than jumping: whatever is under the cursor stays under it.
 */
function onWheel(event: WheelEvent) {
  event.preventDefault()

  if (event.shiftKey) {
    offset.value = clampOffset(offset.value + (event.deltaY / trackWidth()) * span.value)
    return
  }

  const anchor = msAtClientX(event.clientX)
  const next = Math.min(MAX_ZOOM, Math.max(1, zoom.value * Math.exp(-event.deltaY * 0.002)))
  if (next === zoom.value) return

  const ratio = (anchor - offset.value) / span.value
  zoom.value = next
  offset.value = clampOffset(anchor - ratio * (content.value / next))
}

function fitView() {
  zoom.value = 1
  offset.value = 0
}

defineExpose({ fitView })

/**
 * Pull a time towards the edges that matter.
 *
 * Without it, lining a title up with the in point is a pixel-hunting exercise
 * and the result is off by a frame nobody can see but the export can.
 */
function snap(ms: number, ignoreId?: string): number {
  const tolerance = (SNAP_PIXELS / trackWidth()) * span.value
  const candidates = [0, props.length, props.playhead]
  for (const layer of layers.value) {
    if (layer.id === ignoreId) continue
    candidates.push(layer.start, layerEnd(layer))
  }

  let best = ms
  let bestDistance = tolerance
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - ms)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function startDrag(event: PointerEvent, next: Drag) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  drag.value = next
  if (next.kind === 'playhead') emit('scrubStart')
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  applyDrag(event)
}

function applyDrag(event: PointerEvent) {
  const current = drag.value
  if (!current) return
  const raw = msAtClientX(event.clientX)

  if (current.kind === 'playhead') {
    // The line goes where the pointer is, now. Rebuilding the frame behind it
    // can take a remount and a replay, and tying the marker to that made the
    // whole timeline feel like it was resisting — you drag, nothing moves, then
    // it jumps. The warning tint already says the picture is catching up.
    scrubbing.value = Math.round(raw)
    emit('scrub', Math.round(raw))
    return
  }

  const index = layers.value.findIndex(layer => layer.id === current.id)
  const layer = layers.value[index]
  if (!layer) return
  const updated = { ...layer }

  // Bounded by the content, never by `span`. `span` is how much of the timeline
  // happens to be on screen, so bounding a clip with it made the room to move
  // depend on the zoom: at 2× a clip refused to go past the middle of the take,
  // and zooming out silently changed where it was allowed to sit.
  if (current.grab === 'body') {
    const start = snap(raw - current.offset, layer.id)
    updated.start = Math.max(0, Math.min(start, content.value - layer.duration))
  } else if (current.grab === 'start') {
    const earliest = layer.start - (layer.trim ?? 0) / layerSpeed(layer)
    const start = Math.max(0, earliest, Math.min(snap(raw, layer.id), layerEnd(layer) - MIN_SEGMENT))
    updated.trim = (layer.trim ?? 0) + (start - layer.start) * layerSpeed(layer)
    updated.duration = layerEnd(layer) - start
    updated.start = start
  } else {
    const end = Math.min(content.value, Math.max(snap(raw, layer.id), layer.start + MIN_SEGMENT))
    updated.duration = end - layer.start
  }

  updated.start = Math.round(updated.start)
  updated.duration = Math.round(updated.duration)
  layers.value = layers.value.map((entry, at) => (at === index ? updated : entry))
}

function endDrag(event: PointerEvent) {
  if (!drag.value) return
  if (drag.value.kind === 'playhead') emit('scrubEnd')
  drag.value = null
  scrubbing.value = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
}

function onClipDown(event: PointerEvent, layer: Layer, grab: 'body' | 'start' | 'end') {
  emit('select', layer.id)
  startDrag(event, { kind: 'clip', id: layer.id, grab, offset: msAtClientX(event.clientX) - layer.start })
}

/**
 * Ticks on a 0.5, 1, 2 or 5 second grid.
 *
 * Picking the step from the span keeps the ruler readable at any length rather
 * than crowding into a solid band on a long take.
 */
/**
 * Ruler marks on a 1-2-5 grid, chosen from the visible span.
 *
 * Zooming has to change the grid or the ruler either crowds into a solid band
 * or leaves you counting pixels between two labels.
 */
const ticks = computed(() => {
  const seconds = span.value / 1000
  const rough = seconds / 8
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-4)))
  const normalized = rough / magnitude
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude

  const marks: { at: number, label: string, ms: number }[] = []
  const first = Math.floor(offset.value / 1000 / step) * step
  for (let t = first; t <= (offset.value + span.value) / 1000 + step; t += step) {
    if (t < 0) continue
    const ms = t * 1000
    marks.push({
      at: percent(ms),
      ms,
      label: step < 1 ? `${t.toFixed(step < 0.1 ? 2 : 1)}s` : `${Math.round(t)}s`,
    })
  }
  return marks.filter(mark => mark.at >= -5 && mark.at <= 105)
})

/**
 * Media dropped straight onto the time it should start at.
 *
 * The file dialog behind the plus menu could only ever place a clip at the
 * playhead — you picked the file, then went and moved the clip. A drop already
 * carries the one thing the dialog was missing: where.
 *
 * Held as a time rather than a boolean so the frame can show *where* it would
 * land. A drop zone that only says "yes, a file" leaves you to guess.
 */
const dropAt = ref<number | null>(null)

/** True for a drag carrying files, false for text selections and dragged clips. */
function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragOver(event: DragEvent) {
  if (!isFileDrag(event)) return
  // Preventing the default is what marks this as a drop target at all; without
  // it the browser navigates to the file and takes the session with it.
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dropAt.value = Math.max(0, Math.round(msAtClientX(event.clientX)))
}

/**
 * Only when the pointer has actually left.
 *
 * `dragleave` fires on every internal boundary crossed on the way across — the
 * ruler, each lane, each clip — and clearing on all of them made the marker
 * flicker out under the cursor.
 */
function onDragLeave(event: DragEvent) {
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as HTMLElement).contains(next)) return
  dropAt.value = null
}

function onDrop(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  const at = dropAt.value ?? Math.max(0, Math.round(msAtClientX(event.clientX)))
  dropAt.value = null
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) emit('dropFiles', files, at)
}

/**
 * A colour per kind.
 *
 * Reading a timeline is mostly pattern matching — you want to find the titles
 * among the footage at a glance, not read every label.
 *
 * The one place in the chrome that stays on literal hues rather than theme
 * tokens, because these four are a set: nothing here is a success or a warning,
 * they only have to be four things telling each other apart. Routing two of them
 * through the status tokens would leave a palette that matches in one theme and
 * not the other, and it would mean a clip changed colour the day somebody
 * retuned what "warning" looks like. Tints and hairlines rather than fills, so
 * the same four read against black and against white.
 */
const KIND_STYLE: Record<Layer['kind'], string> = {
  component: 'border-sky-400/40 bg-sky-500/25',
  video: 'border-violet-400/40 bg-violet-500/25',
  image: 'border-emerald-400/40 bg-emerald-500/25',
  text: 'border-amber-400/40 bg-amber-500/25',
}

const ICONS: Record<Layer['kind'], string> = {
  component: 'i-lucide-square-play',
  video: 'i-lucide-film',
  image: 'i-lucide-image',
  text: 'i-lucide-type',
}

/** A clip's width as a percentage of the visible window. */
function clipWidth(layer: Layer) {
  return percent(layerEnd(layer)) - percent(layer.start)
}

/** Frames rather than seconds, for the readouts that are about precision. */
const frameAt = computed(() => Math.round((props.playhead / 1000) * props.fps) + 1)
const totalFrames = computed(() => Math.max(1, Math.round((props.length / 1000) * props.fps)))

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`
</script>

<template>
  <!--
    No top border. The splitter above already draws the hairline that divides the
    timeline from the frame, and a border here put a second line two pixels under
    the first — a seam where there is only one edge. A drop is announced by
    outlining the area that accepts it, which is the truer shape of the message.
  -->
  <div
    class="flex shrink-0 flex-col overflow-hidden bg-default transition-shadow"
    :class="dropAt === null ? '' : 'ring-1 ring-inset ring-primary-500/60'"
    @dragenter="onDragOver"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="flex items-center gap-2 border-b border-default/80 px-3 py-2">
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center border border-muted text-muted transition-colors hover:border-accented hover:text-default"
        :title="playing ? 'Pause (space)' : 'Play (space)'"
        @click="emit('togglePlay')"
      >
        <UIcon :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-3.5" />
      </button>

      <span class="font-mono text-[11px] tabular-nums text-highlighted">{{ seconds(playhead) }}</span>
      <span class="font-mono text-[10px] text-dimmed/70">/ {{ seconds(length) }}</span>

      <!-- The frame number, because a cut is decided in frames and read in seconds. -->
      <span class="border border-muted/80 px-1.5 py-px font-mono text-[10px] tabular-nums text-muted">
        f{{ frameAt }}<span class="text-dimmed/70">/{{ totalFrames }}</span>
      </span>

      <span class="font-mono text-[10px] text-dimmed/70">
        {{ frames }} frames · {{ seconds(outputMs) }} out
      </span>

      <!-- Only worth saying when it is not the default, and it doubles as the
           way back: the label is the button that fits the take again. -->
      <button
        v-if="zoom > 1.01"
        type="button"
        class="border border-muted px-1.5 py-px font-mono text-[10px] text-muted transition-colors hover:border-accented hover:text-default"
        title="Fit the whole take (Z)"
        @click="fitView"
      >
        {{ zoom.toFixed(1) }}× · fit
      </button>

      <div class="ml-auto flex items-center gap-1">
        <!--
          Everything that produces pixels is media: a built-in animation is a
          source like a file is, not a category of its own. What gets *added* to
          media is motion, and that lives in the animation list on each clip.
        -->
        <button
          ref="mediaButton"
          type="button"
          class="border px-2 py-1 font-mono text-[10px] transition-colors"
          :class="mediaMenu
            ? 'border-primary-500/60 text-primary'
            : 'border-muted text-muted hover:border-accented hover:text-default'"
          @pointerdown.stop
          @click="toggleMediaMenu"
        >
          + media
        </button>

        <!--
          Rendered on the body, and positioned from the button's own rectangle.
          The menu opens upwards, past the top of a timeline that is clipped to
          its height — so wherever it was anchored inside, it was cut away and
          the button read as dead. There is no ancestor here that can be relied
          on not to clip; leaving the tree is the only fix that stays fixed.
        -->
        <Teleport to="body">
          <div
            v-if="mediaMenu && mediaMenuAt"
            class="lab-chrome fixed z-200 min-w-44 border border-muted bg-muted py-1 shadow-[var(--lab-shadow-overlay)]"
            :data-theme="isDark ? 'dark' : 'light'"
            :style="{ left: `${mediaMenuAt.x}px`, top: `${mediaMenuAt.y}px`, transform: 'translate(-100%, -100%)' }"
            @pointerdown.stop
          >
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-toned transition-colors hover:bg-elevated hover:text-highlighted"
              @click="mediaMenu = false; emit('addComponent')"
            >
              <UIcon name="i-lucide-square-play" class="size-3 text-dimmed/70" />
              Built-in animation
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-toned transition-colors hover:bg-elevated hover:text-highlighted"
              @click="mediaMenu = false; emit('addImage')"
            >
              <UIcon name="i-lucide-image" class="size-3 text-dimmed/70" />
              Image or video…
            </button>
          </div>
        </Teleport>
        <button
          type="button"
          class="border border-muted px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:border-accented hover:text-default"
          @click="emit('addText')"
        >
          + text
        </button>
      </div>
    </div>

    <!--
      The empty space under the tracks is empty space, and clicking it clears the
      selection. Rows and clips stop the event themselves, so only a click that
      genuinely landed on nothing reaches here.
    -->
    <div
      class="relative flex min-h-0 flex-1 overflow-y-auto pb-4"
      @pointerdown.self="emit('select', null)"
    >
      <!-- Track names, held out of the scrolling time area so they stay readable. -->
      <div
        class="w-36 shrink-0 border-r border-default bg-default"
        @pointerdown.self="emit('select', null)"
      >
        <div class="flex h-7 items-center px-3 font-mono text-[10px] text-dimmed/70">
          timeline
        </div>
        <!--
          The names are the handle for stacking order.
          Order is draw order — later layers land on top — and it is the one
          property of a layer that no number in the panel can express. Dragging
          the name is where the hand goes, and it keeps the time area for time.
        -->
        <div
          v-for="(layer, index) in layers"
          :key="layer.id"
          class="group/name relative flex h-8 w-full items-center gap-1.5 px-3 text-left"
          :class="[
            selectedId === layer.id ? 'bg-primary-500/10' : 'hover:bg-elevated/60',
            isLifted(index)
              ? 'z-20 cursor-grabbing bg-elevated ring-1 ring-primary-500/50'
              : 'cursor-grab transition-[transform,background-color] duration-200 ease-out',
          ]"
          :style="{
            transform: `translateY(${stackShift(index)}px)`,
            // Inline, not a utility: `ring` and `shadow` share one box-shadow
            // chain in Tailwind v4, and the ring on this row was winning it.
            boxShadow: isLifted(index) ? 'var(--lab-shadow-overlay)' : undefined,
          }"
          @pointerdown="onStackDown($event, layer, index)"
          @pointermove="onStackMove"
          @pointerup="onStackUp"
          @pointercancel="onStackUp"
        >
          <UIcon
            :name="ICONS[layer.kind]"
            class="size-3 shrink-0 transition-colors"
            :class="selectedId === layer.id ? 'text-primary' : 'text-dimmed/70'"
          />
          <span
            class="truncate font-mono text-[10px] transition-colors"
            :class="selectedId === layer.id ? 'text-primary' : 'text-muted'"
          >{{ layer.name }}</span>
          <!--
            The grip earns its place on approach.
            Always-on it is furniture in a column that is mostly names; absent it
            leaves the row looking inert. Fading in under the pointer says the
            row can be picked up at the moment anyone could act on it.
          -->
          <UIcon
            name="i-lucide-grip-vertical"
            class="ml-auto size-3 shrink-0 transition-[color,opacity] duration-150"
            :class="isLifted(index)
              ? 'text-primary opacity-100'
              : 'text-dimmed/70 opacity-0 group-hover/name:opacity-100'"
          />
        </div>
      </div>

      <div class="relative min-w-0 flex-1" @pointerdown.self="emit('select', null)">
        <!-- The ruler owns the pointer geometry; every time below is measured against it. -->
        <div
          ref="ruler"
          class="relative h-7 select-none overflow-hidden border-b border-default bg-muted"
          :class="drag?.kind === 'playhead' ? 'cursor-grabbing' : 'cursor-pointer'"
          @wheel="onWheel"
          @pointerdown="startDrag($event, { kind: 'playhead' })"
          @pointermove="applyDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        >
          <!-- Past the take: scrubbing room, never exported. -->
          <div class="pointer-events-none absolute inset-y-0 right-0 bg-default/50" :style="{ left: `${percent(length)}%` }" />
          <div class="pointer-events-none absolute inset-y-0 w-px bg-accented" :style="{ left: `${percent(length)}%` }" />

          <div
            v-for="tick in ticks"
            :key="tick.at"
            class="pointer-events-none absolute bottom-0 flex h-full flex-col justify-end"
            :style="{ left: `${tick.at}%` }"
          >
            <span class="absolute bottom-2.5 left-1 font-mono text-[9px] text-dimmed/70">{{ tick.label }}</span>
            <div class="h-1.5 w-px bg-accented" />
          </div>

        </div>

        <div class="relative overflow-hidden" @wheel="onWheel">
          <!--
            The lane moves with its name.
            Names and clips are two halves of one row, and reordering only reads
            as reordering if both travel together — otherwise the labels slide
            while the clips sit still and the pairing comes apart mid-gesture.
          -->
          <div
            v-for="(layer, index) in layers"
            :key="layer.id"
            class="relative h-8 cursor-default border-b border-default/60"
            :class="[
              isLifted(index) ? 'z-20' : 'transition-transform duration-200 ease-out',
              stackDrag?.lifted && !isLifted(index) ? 'opacity-60' : '',
            ]"
            :style="{ transform: `translateY(${stackShift(index)}px)` }"
            @pointerdown="emit('select', null)"
          >
            <div
              v-if="!offscreen(layer.start) || !offscreen(layerEnd(layer))"
              class="group/clip absolute top-1 h-6 cursor-grab select-none rounded-[3px] border shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-150"
              :class="[
                KIND_STYLE[layer.kind],
                selectedId === layer.id
                  ? 'z-10 ring-1 ring-primary-500/70 ring-offset-1 ring-offset-default'
                  : 'hover:-translate-y-px hover:brightness-125',
                drag?.kind === 'clip' && drag.id === layer.id ? 'cursor-grabbing brightness-125' : '',
              ]"
              :style="{ left: `${percent(layer.start)}%`, width: `${percent(layerEnd(layer)) - percent(layer.start)}%` }"
              @pointerdown="onClipDown($event, layer, 'body')"
              @pointermove="applyDrag"
              @pointerup="endDrag"
              @pointercancel="endDrag"
              @pointerenter="hoveredId = layer.id"
              @pointerleave="hoveredId = null"
              @contextmenu.prevent.stop="openMenu($event, layer)"
            >
              <span class="pointer-events-none flex h-full items-center gap-1 truncate px-2 font-mono text-[9px] text-highlighted">
                <UIcon :name="ICONS[layer.kind]" class="size-2.5 shrink-0 opacity-70" />
                <span class="truncate">{{ layer.name }}</span>
                <!-- Animated clips carry a mark, so the timeline says which ones move. -->
                <UIcon
                  v-if="layer.effects?.length"
                  name="i-lucide-sparkles"
                  class="ml-auto size-2.5 shrink-0 opacity-60"
                />
                <span v-if="canChangeLayerSpeed(layer) && layerSpeed(layer) !== 1" class="shrink-0 tabular-nums opacity-60">
                  {{ Number(layerSpeed(layer).toFixed(2)) }}×
                </span>
                <!-- Only once the clip is wide enough that a number reads as a
                     number rather than as noise crowding the name. -->
                <span
                  v-if="clipWidth(layer) > 12"
                  class="shrink-0 tabular-nums opacity-60"
                  :class="layer.effects?.length ? '' : 'ml-auto'"
                >{{ (layer.duration / 1000).toFixed(2) }}s</span>
              </span>

              <!-- Drawn, not just hoverable: a handle you cannot see is a handle you cannot aim at. -->
              <div
                class="absolute inset-y-0 left-0 w-1.5 cursor-col-resize rounded-l-[3px] transition-colors"
                :class="hoveredId === layer.id || selectedId === layer.id ? 'bg-inverted/70' : 'bg-inverted/20'"
                @pointerdown="onClipDown($event, layer, 'start')"
                @pointermove="applyDrag"
                @pointerup="endDrag"
                @pointercancel="endDrag"
              />
              <div
                class="absolute inset-y-0 right-0 w-1.5 cursor-col-resize rounded-r-[3px] transition-colors"
                :class="hoveredId === layer.id || selectedId === layer.id ? 'bg-inverted/70' : 'bg-inverted/20'"
                @pointerdown="onClipDown($event, layer, 'end')"
                @pointermove="applyDrag"
                @pointerup="endDrag"
                @pointercancel="endDrag"
              />

              <!--
                The ramps, drawn from the effects that produce them.

                These read `fadeIn` and `fadeOut` until now — fields the effect
                library replaced, migrated away on load and written by no factory
                since. So they had quietly stopped drawing on every document made
                after that change. The sparkles icon says a clip is animated;
                this says for how long.
              -->
              <div
                v-if="ramps.get(layer.id)?.in"
                class="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-default/60 to-transparent"
                :style="{ width: ramps.get(layer.id)!.in! }"
              />
              <div
                v-if="ramps.get(layer.id)?.out"
                class="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-default/60 to-transparent"
                :style="{ width: ramps.get(layer.id)!.out! }"
              />
            </div>
          </div>
        </div>

        <!--
          The playhead spans every track, so alignment is visible at a glance —
          and is clipped to the time area. Zoomed in, a position before the
          window sits at a negative percentage, and unclipped it was drawn over
          the track names to the left: a playhead reading 0.00s parked in a
          column that has no time in it at all.
        -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            v-if="headAt >= -1 && headAt <= 101"
            class="absolute inset-y-0 w-px"
            :class="seeking ? 'bg-warning' : 'bg-inverted'"
            :style="{ left: `${headAt}%` }"
          />
          <div
            v-if="headAt >= -1 && headAt <= 101"
            class="absolute top-0 size-2 -translate-x-1/2"
            :class="seeking ? 'bg-warning' : 'bg-inverted'"
            :style="{ left: `${headAt}%` }"
          />

          <!--
            Off-window: say which way it went.
            Zoomed in, the playhead can sit outside the visible span, and simply
            not drawing it leaves no way to tell whether it is behind you or
            ahead — the timeline looks like it has lost its position. The arrow
            is the way back, so it takes the pointer the layer above it drops.
          -->
          <button
            v-if="headAt < -1 || headAt > 101"
            type="button"
            class="pointer-events-auto absolute top-0 flex h-7 items-center gap-1 bg-inverted/90 px-1.5 font-mono text-[9px] text-inverted transition-colors hover:bg-inverted"
            :class="headAt < 0 ? 'left-0' : 'right-0'"
            :title="`Playhead at ${seconds(playhead)} — click to bring it into view`"
            @click="revealPlayhead"
          >
            <span>{{ headAt < 0 ? '◀' : '▶' }}</span>
            {{ seconds(playhead) }}
          </button>

          <!--
            Where the drop would land, on the same geometry as the playhead.
            The pixel the file is over is the frame it starts on, so the marker
            has to be a line on the time axis rather than a glow around the
            whole panel — that would only have said "somewhere in here".
          -->
          <template v-if="dropAt !== null">
            <div
              class="absolute inset-y-0 w-px bg-primary-500"
              :style="{ left: `${percent(dropAt)}%` }"
            />
            <span
              class="absolute top-0.5 whitespace-nowrap border border-primary-500/50 bg-default px-1 py-px font-mono text-[9px] text-primary"
              :style="{ left: `min(${percent(dropAt)}%, calc(100% - 5.5rem))` }"
            >
              drop at {{ seconds(dropAt) }}
            </span>
          </template>
        </div>
      </div>
    </div>

    <!--
      Fixed rather than nested in the track, so the menu is never clipped by the
      timeline's own scroll container.
    -->
    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuEl"
        class="lab-chrome fixed z-200 min-w-40 border border-muted bg-muted py-1 shadow-[var(--lab-shadow-overlay)]"
        :data-theme="isDark ? 'dark' : 'light'"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @pointerdown.stop
        @contextmenu.prevent
      >
        <button
          v-for="item in [
            { key: 'duplicate', label: 'Duplicate', hint: '⌘D', enabled: true },
            { key: 'copy', label: 'Copy', hint: '⌘C', enabled: true },
            { key: 'split', label: 'Split at playhead', hint: 'C', enabled: canSplit },
            { key: 'join', label: 'Join with neighbour', hint: 'J', enabled: canRejoin },
            { key: 'remove', label: 'Delete', hint: '⌫', enabled: true },
          ]"
          :key="item.key"
          type="button"
          class="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left font-mono text-[11px] transition-colors"
          :class="item.enabled
            ? 'text-toned hover:bg-elevated hover:text-highlighted'
            : 'cursor-not-allowed text-dimmed/55'"
          :disabled="!item.enabled"
          @click="run(item.key as 'duplicate' | 'copy' | 'split' | 'join' | 'remove')"
        >
          <span>{{ item.label }}</span>
          <span class="text-dimmed/70">{{ item.hint }}</span>
        </button>
        <div class="my-1 border-t border-default" />
        <button
          type="button"
          class="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left font-mono text-[11px] text-toned transition-colors hover:bg-elevated hover:text-highlighted"
          @click="closeMenu(); emit('paste')"
        >
          <span>Paste at playhead</span>
          <span class="text-dimmed/70">⌘V</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
