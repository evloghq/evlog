<script setup lang="ts">
import type { LabMenuAction } from './LabMenu.vue'
import { DEFAULT_SETTINGS, FRAME_RATES, HINTS, OUTPUT_PRESETS, RANGES, SPEEDS, VIEWPORTS, frameCountFor, outputDuration } from '~/utils/lab/settings'
import type { AsciiSet, LabSettings, RangedKey, StylizeMode } from '~/utils/lab/settings'
import { ASCII_MIN_CELL } from '~/utils/lab/ascii'
import type { LabMode } from '~/utils/lab/storage'
import type { Layer } from '~/utils/lab/layers'
import type { LayerEffect } from '~/utils/lab/effects'

const props = defineProps<{
  /** Set while a video export is running; blocks anything that would change the frame. */
  busy: boolean
  progress: number
  /** False when the driver refused half-float targets, which flattens bloom. */
  highPrecision: boolean
  captureMs: number
  /** Briefly true after a share link is copied. */
  linkCopied: boolean
  /** Briefly true after the frame is copied to the clipboard. */
  pngCopied: boolean
  /** A shot has no timeline, so everything about timing is moot in one. */
  mode: LabMode
  /** Whether interaction sounds are on. Shown in the header, not down a panel. */
  cuesEnabled: boolean
  /** The whole stack, for the layers list. */
  layers: Layer[]
  selectedLayerId: string | null
  selectedLayer: Layer | null
  /** Length the selected clip's animation declares, when it declares one. */
  sequenceMs?: number
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  undo: []
  redo: []
  fit: []
  fitStage: []
  replay: []
  exportVideo: []
  exportPng: []
  copyPng: []
  newDocument: []
  setMode: [mode: LabMode]
  selectLayer: [id: string | null]
  shiftLayer: [id: string, direction: -1 | 1]
  removeLayerById: [id: string]
  addImage: []
  addText: []
  setCues: [enabled: boolean]
  copyLink: []
  projects: []
  shortcuts: []
  resetSettings: []
  resetEverything: []
  cancel: []
  updateLayer: [id: string, patch: Partial<Layer>]
  removeLayer: []
  duplicateLayer: []
}>()

const settings = defineModel<LabSettings>('settings', { required: true })
const picking = defineModel<boolean>('picking', { required: true })
const camera = defineModel<LayerEffect[]>('camera', { required: true })

/**
 * Bind a control to the shared range table, plus the value it resets to.
 *
 * Sourcing both from one place means a control cannot drift from what the
 * renderer will actually accept.
 */
function range(key: RangedKey) {
  return { ...RANGES[key], default: DEFAULT_SETTINGS[key] as number, hint: HINTS[key] }
}

/**
 * Presets as the only way in, and the size stated as the consequence.
 *
 * Width and height were two sliders that could disagree about the ratio, and
 * nobody shooting for a post wants to arrive at 1920 by pixel. A shot arriving
 * from an older link can still hold any size — it just matches no card, and the
 * choice reads as custom rather than as nothing.
 */
const OUTPUT_OPTIONS = OUTPUT_PRESETS.map(preset => ({
  value: preset.id,
  label: preset.label,
  note: `${preset.width}×${preset.height}`,
  title: preset.note,
}))

const activeOutput = computed(() =>
  OUTPUT_PRESETS.find(preset =>
    preset.width === settings.value.outputWidth && preset.height === settings.value.outputHeight,
  )?.id,
)

function setOutput(id: string) {
  const preset = OUTPUT_PRESETS.find(entry => entry.id === id)
  if (!preset) return
  settings.value.outputWidth = preset.width
  settings.value.outputHeight = preset.height
}

const VIEWPORT_OPTIONS = VIEWPORTS.map(viewport => ({
  value: viewport.id,
  label: viewport.label,
  note: `${viewport.width}×${viewport.height}`,
}))

const activeViewport = computed(() =>
  VIEWPORTS.find(viewport =>
    viewport.width === settings.value.stageWidth && viewport.height === settings.value.stageHeight,
  )?.id,
)

function setViewport(id: string) {
  const viewport = VIEWPORTS.find(entry => entry.id === id)
  if (!viewport) return
  settings.value.stageWidth = viewport.width
  settings.value.stageHeight = viewport.height
}

const RATE_OPTIONS = FRAME_RATES.map(rate => ({ value: rate, label: `${rate}fps` }))
const SPEED_OPTIONS = SPEEDS.map(speed => ({ value: speed, label: `${speed}×` }))

/** Icons per kind, so the tab says what sort of thing is selected at a glance. */
const KIND_ICON: Record<string, string> = {
  text: 'i-lucide-type',
  image: 'i-lucide-image',
  video: 'i-lucide-film',
  component: 'i-lucide-square-play',
}

const TABS = computed(() => [
  {
    value: 'layer' as const,
    label: props.selectedLayer?.name ?? 'Layer',
    icon: props.selectedLayer ? KIND_ICON[props.selectedLayer.kind] : undefined,
  },
  { value: 'shot' as const, label: 'Shot', icon: 'i-lucide-aperture' },
])

const activeTab = ref<'layer' | 'shot'>('shot')

// The tool's theme, which is not the document's — see `useLabTheme`. Nothing
// this button does can reach the stage, which is the one thing anyone would fear
// from a light switch in a room built for filming against black.
const { isDark, toggle: toggleTheme } = useLabTheme()

// Selecting a clip is a statement of intent: show what was just selected rather
// than leaving it to be found behind a tab.
watch(() => props.selectedLayer?.id, (id) => {
  activeTab.value = id ? 'layer' : 'shot'
})

/**
 * The panel's own housekeeping, behind one button.
 *
 * Clearing throws away imported media, so it asks once — inside the menu, where
 * there is room to say what it will take with it.
 */
const ACTIONS = computed<LabMenuAction[]>(() => [
  // Above the two destructive actions, and in the same menu as them on purpose:
  // this is the thing that makes "Clear everything" a decision rather than an
  // accident, so it should be visible from where that decision is taken.
  {
    label: 'Undo',
    icon: 'i-lucide-undo-2',
    hint: 'Step back. ⌘Z.',
    disabled: !props.canUndo,
    keepOpen: true,
    select: () => emit('undo'),
  },
  {
    label: 'Redo',
    icon: 'i-lucide-redo-2',
    hint: 'Step forward again. ⌘⇧Z.',
    disabled: !props.canRedo,
    keepOpen: true,
    select: () => emit('redo'),
  },
  // First, and above Projects. The launcher is where a session starts, and it
  // had no way back to it once a document existed — which made both modes
  // unreachable to anyone who had ever used the tool before.
  {
    label: 'New…',
    icon: 'i-lucide-plus',
    hint: 'A shot or a take, from the top.',
    select: () => emit('newDocument'),
  },
  {
    label: props.mode === 'shot' ? 'Turn into a video' : 'Turn into a shot',
    icon: props.mode === 'shot' ? 'i-lucide-film' : 'i-lucide-image',
    // Nothing is thrown away either way: a shot keeps the spans it is ignoring,
    // and a take keeps every layer it was made of.
    hint: props.mode === 'shot'
      ? 'Put this frame on a timeline. Nothing is lost.'
      : 'Keep one frame of this take. The clips are kept.',
    select: () => emit('setMode', props.mode === 'shot' ? 'video' : 'shot'),
  },
  {
    label: 'Projects',
    icon: 'i-lucide-folder-open',
    hint: 'Save, open, export. ⌘O.',
    select: () => emit('projects'),
  },
  {
    label: props.linkCopied ? 'Link copied' : 'Copy link',
    icon: props.linkCopied ? 'i-lucide-check' : 'i-lucide-link',
    hint: 'The whole shot, as a URL.',
    keepOpen: true,
    select: () => emit('copyLink'),
  },
  {
    label: 'Reset settings',
    icon: 'i-lucide-rotate-ccw',
    hint: 'Back to defaults. The layers are kept.',
    select: () => emit('resetSettings'),
  },
  {
    label: 'Clear everything',
    icon: 'i-lucide-trash-2',
    hint: 'Reset the settings and remove every layer.',
    danger: true,
    confirm: 'Clear it all — sure?',
    select: () => emit('resetEverything'),
  },
])

const frameCount = computed(() => frameCountFor(settings.value))
const outputSeconds = computed(() => (outputDuration(settings.value) / 1000).toFixed(1))
const segmentSeconds = computed(() => (settings.value.timelineLength / 1000).toFixed(1))

/**
 * Depth of field needs the plate to be tilted: a flat surface parallel to the
 * sensor is uniformly in focus, so the focus controls genuinely do nothing until
 * there is some rotation. Worth saying outright rather than letting it read as
 * a broken slider.
 */
const hasDepth = computed(() =>
  Math.abs(settings.value.pitch) > 0.5 || Math.abs(settings.value.yaw) > 0.5,
)

/**
 * Dispersion and scatter both scale the colour spread, so both are inert while
 * it is zero. Said outright rather than by disabling them — a control that has
 * gone grey never explains what would bring it back.
 */
const hasSpread = computed(() => settings.value.aberration > 0)

/** Letters need more room than dots do — see `ASCII_MIN_CELL`. */
const minCell = computed(() =>
  settings.value.stylize === 'ascii' ? ASCII_MIN_CELL : RANGES.stylizeScale.min,
)

/**
 * Picking a screen also drags the cell up to what that screen can draw in.
 *
 * Silently rendering at a size the slider does not show would leave the two
 * disagreeing; moving the value is the honest half of enforcing a minimum.
 */
function setScreen(mode: StylizeMode) {
  settings.value.stylize = mode
  if (mode === 'ascii') {
    settings.value.stylizeScale = Math.max(ASCII_MIN_CELL, settings.value.stylizeScale)
  }
}

/**
 * Named for what they do to the picture, with the technique underneath.
 *
 * "Ordered dither" is the name of the algorithm; "Two-tone, dithered" is what
 * you get. The second line is where the technique goes, for anyone who came
 * looking for it by name.
 */
const STYLIZE_OPTIONS = [
  { value: 'none', label: 'None', note: 'The graded frame' },
  { value: 'dither', label: 'Dither', note: 'Ordered, few steps' },
  { value: 'ascii', label: 'Ascii', note: 'Redrawn as type' },
  { value: 'halftone', label: 'Halftone', note: 'Dot screen, print' },
  { value: 'posterize', label: 'Posterize', note: 'Pixelated, banded' },
  { value: 'crt', label: 'CRT', note: 'Scanlines, grille' },
] as const

const ASCII_OPTIONS = [
  { value: 'ascii', label: '.:-=+*#%@', title: 'Ten steps. The safe one.' },
  { value: 'blocks', label: '░▒▓█', title: 'Five steps, solid. Coarse and graphic.' },
  { value: 'shades', label: '·∴▪▦█', title: 'Eight steps of texture rather than of letters.' },
  { value: 'code', label: 'Wgho*#', title: 'Seventy glyphs. The most tone, the least legible.' },
] as const

const CONTAINERS = [
  { value: 'mp4', label: 'mp4', note: 'h.264 · plays anywhere' },
  { value: 'webm', label: 'webm', note: 'vp9 · smaller file' },
] as const
</script>

<template>
  <!--
    A container, so the controls inside can answer the panel's width rather than
    the window's. This panel is dragged between 240 and 560 pixels: a five-across
    row of buttons that is comfortable at one end is unreadable at the other, and
    a media query cannot tell the difference because the window never changed.
  -->
  <!-- No left border: the splitter beside it is the divider. -->
  <aside class="@container flex h-full shrink-0 flex-col bg-default">
    <header class="flex items-center justify-between gap-2 border-b border-default px-3 py-3 @min-[280px]:px-4">
      <!-- The title holds one line and gives up characters before it gives up the row. -->
      <span class="min-w-0 truncate font-pixel text-[11px] uppercase tracking-[0.2em] text-default">
        Render labs
      </span>

      <div class="flex shrink-0 items-center gap-1">
        <!--
          Out of the menu and into the header. Saving is the one action in the app that decides
          whether anything survives the tab.
        -->
        <!--
          Beside Projects, and not inside the menu with it. Starting something is the first thing
          anyone does here, so it should not need finding.
        -->
        <button
          type="button"
          data-cuelume-press
          class="flex size-5 items-center justify-center rounded-full border border-muted text-dimmed transition-colors hover:border-primary-500/60 hover:bg-primary-500/10 hover:text-primary"
          aria-label="New shot or video"
          title="New — a shot or a take, from the top"
          @click="emit('newDocument')"
        >
          <UIcon name="i-lucide-plus" class="size-3" />
        </button>
        <button
          type="button"
          data-cuelume-press
          class="flex size-5 items-center justify-center rounded-full border border-muted text-dimmed transition-colors hover:border-primary-500/60 hover:bg-primary-500/10 hover:text-primary"
          aria-label="Projects"
          title="Projects — save, open, export (⌘O)"
          @click="emit('projects')"
        >
          <UIcon name="i-lucide-folder" class="size-3" />
        </button>
        <!--
          In the header rather than down the menu, for the same reason Projects is: a control nobody
          can find is a control nobody has. It is the one button whose job is to change how
          everything else looks, so it has to be visible. It shows the destination, not the state. A
          moon on a dark panel is a badge saying where you already are; a sun says what clicking
          does.
        -->
        <button
          type="button"
          data-cuelume-press
          class="flex size-5 items-center justify-center rounded-full border border-muted text-dimmed transition-colors hover:border-primary-500/60 hover:bg-primary-500/10 hover:text-primary"
          :aria-label="isDark ? 'Switch the panel to light' : 'Switch the panel to dark'"
          :title="isDark ? 'Light panel — the shot is unaffected' : 'Dark panel — the shot is unaffected'"
          @click="toggleTheme"
        >
          <UIcon :name="isDark ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-3" />
        </button>
        <!--
          In the header, beside the light switch, and not behind the ellipsis.
          This tool is used while its user is recording a screen: a lab that
          chirps under a take being narrated has to be silenceable without a
          hunt, and the state has to be readable at a glance before recording
          starts rather than discovered in the edit.
        -->
        <button
          type="button"
          data-cuelume-press
          class="flex size-5 items-center justify-center rounded-full border border-muted text-dimmed transition-colors hover:border-primary-500/60 hover:bg-primary-500/10 hover:text-primary"
          :aria-label="cuesEnabled ? 'Mute the interface' : 'Unmute the interface'"
          :title="cuesEnabled ? 'Sound on — mute before recording your screen' : 'Sound off'"
          @click="emit('setCues', !cuesEnabled)"
        >
          <UIcon :name="cuesEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-off'" class="size-3" />
        </button>
        <!--
          Sized to be found. At sixteen pixels this read as punctuation after the
          title rather than as the way into the only documentation the tool has.
        -->
        <button
          type="button"
          data-cuelume-press
          class="flex size-5 items-center justify-center rounded-full border border-muted font-mono text-[11px] leading-none text-dimmed transition-colors hover:border-primary-500/60 hover:bg-primary-500/10 hover:text-primary"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          @click="emit('shortcuts')"
        >
          ?
        </button>
        <LabMenu :actions="ACTIONS" label="Panel actions" />
      </div>
    </header>

    <!--
      The strip exists only when there is a choice to make.
      A permanent "Layer" tab that is disabled most of the time advertises a
      place you are usually not allowed to go, which reads as something broken
      rather than as something empty. With nothing selected there is exactly one
      thing this panel can show, so it shows it and says nothing. The moment a
      clip is selected a second destination exists — and it is named after the
      clip, so the panel states what is being edited instead of leaving it to be
      inferred from the fields.
    -->

    <!--
      Above the tabs, not inside them. It is the list of what is in the picture, and everything
      below it is a way of treating one of these.
    -->
    <LabSection title="Layers">
      <LabLayers
        :layers
        :selected-id="selectedLayerId"
        @select="emit('selectLayer', $event)"
        @update="(id, patch) => emit('updateLayer', id, patch)"
        @reorder="(id, direction) => emit('shiftLayer', id, direction)"
        @remove="emit('removeLayerById', $event)"
      />

      <div class="mt-2 grid grid-cols-2 gap-1">
        <button
          type="button"
          data-cuelume-press
          class="border border-muted py-[5px] font-mono text-[10px] text-muted transition-colors hover:border-accented hover:text-default"
          @click="emit('addImage')"
        >
          + media
        </button>
        <button
          type="button"
          data-cuelume-press
          class="border border-muted py-[5px] font-mono text-[10px] text-muted transition-colors hover:border-accented hover:text-default"
          @click="emit('addText')"
        >
          + text
        </button>
      </div>
    </LabSection>

    <div v-if="selectedLayer" class="flex shrink-0 border-b border-default">
      <button
        v-for="tab in TABS"
        :key="tab.value"
        type="button"
        class="relative min-w-0 flex-1 px-3 py-2 font-mono text-[10px] transition-colors"
        :class="activeTab === tab.value ? 'text-highlighted' : 'text-dimmed/70 hover:text-toned'"
        @click="activeTab = tab.value"
      >
        <span class="flex items-center justify-center gap-1.5">
          <UIcon v-if="tab.icon" :name="tab.icon" class="size-3 shrink-0 opacity-70" />
          <span class="truncate">{{ tab.label }}</span>
        </span>
        <span
          class="absolute inset-x-0 bottom-0 h-px transition-colors"
          :class="activeTab === tab.value ? 'bg-primary-500' : 'bg-transparent'"
        />
      </button>
    </div>

    <div v-if="selectedLayer" v-show="activeTab === 'layer'" class="min-h-0 flex-1 overflow-y-auto">
      <LabLayerProps
        :layer="selectedLayer"
        :timeline-length="settings.timelineLength"
        :sequence-ms
        @update="emit('updateLayer', selectedLayer.id, $event)"
        @remove="emit('removeLayer')"
        @duplicate="emit('duplicateLayer')"
      />
    </div>

    <div v-show="activeTab === 'shot' || !selectedLayer" class="min-h-0 flex-1 overflow-y-auto">
      <!--
        Named for what it is. Not the renderer's word for it, which means nothing to someone opening
        the panel.
      -->
      <LabSection title="Viewport">
        <p class="mb-2 font-mono text-[10px] leading-relaxed text-dimmed">
          The window your component is laid out in before it is filmed. Narrow it
          to shoot the layout a phone gets.
        </p>

        <LabChoice
          label="Screen"
          :options="VIEWPORT_OPTIONS"
          :model-value="activeViewport"
          cards
          @update:model-value="setViewport(String($event))"
        />

        <div class="grid grid-cols-1 gap-1 @min-[300px]:grid-cols-2">
          <button
            type="button"
            data-cuelume-press
            class="border border-muted py-[5px] font-mono text-[10px] text-muted hover:border-accented hover:text-default transition-colors"
            title="Trim the viewport height to what the component actually occupies, so the camera has no dead frame to compose around."
            @click="emit('fitStage')"
          >
            trim to content
          </button>
          <button
            type="button"
            data-cuelume-press
            class="border border-muted py-[5px] font-mono text-[10px] text-muted hover:border-accented hover:text-default transition-colors"
            title="Restart the staged animation from its first frame."
            @click="emit('replay')"
          >
            replay
          </button>
        </div>
      </LabSection>

      <LabSection title="Camera">
        <button
          type="button"
          data-cuelume-press
          class="mb-2 w-full border border-muted py-[5px] font-mono text-[10px] text-muted transition-colors hover:border-accented hover:text-default"
          title="Back to a square-on, edge-to-edge framing. The grade is left alone."
          @click="emit('fit')"
        >
          reset the framing
        </button>

        <LabNumber v-model="settings.pitch" label="Pitch" v-bind="range('pitch')" />
        <LabNumber v-model="settings.yaw" label="Yaw" v-bind="range('yaw')" />
        <LabNumber v-model="settings.roll" label="Roll" v-bind="range('roll')" />
        <LabNumber v-model="settings.zoom" label="Zoom" v-bind="range('zoom')" />
        <LabNumber v-model="settings.fov" label="Field of view" v-bind="range('fov')" />
        <LabNumber v-model="settings.panX" label="Pan X" v-bind="range('panX')" />
        <LabNumber v-model="settings.panY" label="Pan Y" v-bind="range('panY')" />

        <!--
          Moves on the shot rather than on a layer: dolly travels, slide pans,
          spin rolls, fade takes the frame to black.
        -->
        <div class="mt-3 mb-1 font-pixel text-[10px] uppercase tracking-[0.18em] text-dimmed">
          Moves
        </div>
        <LabEffects
          :effects="camera"
          empty-label="No moves — the camera holds."
          @update="camera = $event"
        />
      </LabSection>

      <LabSection title="Focus">
        <div class="flex items-center gap-1">
          <div class="min-w-0 flex-1">
            <LabNumber v-model="settings.focus" label="Focal plane" v-bind="range('focus')" />
          </div>
          <button
            type="button"
            data-cuelume-press
            class="shrink-0 border p-[5px] transition-colors"
            :class="picking
              ? 'border-primary-500/60 text-primary'
              : 'border-muted text-dimmed hover:border-accented hover:text-toned'"
            title="Pick the focal plane by clicking the frame"
            @click="picking = !picking"
          >
            <UIcon name="i-lucide-crosshair" class="block size-3" />
          </button>
        </div>
        <LabNumber v-model="settings.focusRange" label="Sharp band" v-bind="range('focusRange')" />
        <LabNumber v-model="settings.aperture" label="Bokeh strength" v-bind="range('aperture')" />
        <LabNumber v-model="settings.blurRadius" label="Max blur" v-bind="range('blurRadius')" />

        <!--
          The shape of the aperture, which is what separates a photographed
          highlight from a blur. Only offered once there is blur to shape: at
          aperture zero these two set the geometry of something with no radius.
        -->
        <template v-if="settings.aperture > 0">
          <LabNumber v-model="settings.bokehBlades" label="Aperture blades" v-bind="range('bokehBlades')" />
          <LabNumber v-model="settings.bokehCatEye" label="Cat's eye" v-bind="range('bokehCatEye')" />
          <LabNumber v-model="settings.bokehSwirl" label="Swirl" v-bind="range('bokehSwirl')" />
          <LabNumber v-model="settings.bokehSqueeze" label="Anamorphic bokeh" v-bind="range('bokehSqueeze')" />
        </template>

        <!--
          The tilt sits with the focal plane rather than with the bokeh, because
          it moves where the sharpness is rather than what the blur looks like.
          Its direction only appears once there is a lean to point.
        -->
        <LabNumber v-model="settings.focusTilt" label="Plane tilt" v-bind="range('focusTilt')" />
        <LabNumber
          v-if="Math.abs(settings.focusTilt) > 0.002"
          v-model="settings.focusTiltAngle"
          label="Tilt axis"
          v-bind="range('focusTiltAngle')"
        />

        <p v-if="!hasDepth" class="mt-2 font-mono text-[10px] leading-relaxed text-warning">
          The plate faces the camera square-on, so every point of it is the same
          distance away and there is nothing to focus through. Add pitch or yaw.
        </p>
      </LabSection>

      <!--
        Named for what it is rather than for the pass that makes it. Everything
        in here is what happens to light too bright for the sensor to hold, and
        the four things under the glow are the four ways a lens spills it.
      -->
      <LabSection title="Light">
        <LabNumber v-model="settings.emission" label="Source brightness" v-bind="range('emission')" />
        <LabNumber v-model="settings.bloomIntensity" label="Glow" v-bind="range('bloomIntensity')" />
        <LabNumber v-model="settings.bloomThreshold" label="Threshold" v-bind="range('bloomThreshold')" />
        <LabNumber v-model="settings.bloomRadius" label="Spread" v-bind="range('bloomRadius')" />
        <!--
          These three ride the same thresholded mip chain the glow does, so they
          belong with it: dragging any of them with the glow at zero would appear
          to do nothing, and there would be nothing on screen to say why.
        -->
        <LabNumber v-model="settings.bleed" label="Halation" v-bind="range('bleed')" />
        <LabNumber v-model="settings.streaks" label="Anamorphic streak" v-bind="range('streaks')" />
        <LabNumber v-model="settings.ghosts" label="Ghosts" v-bind="range('ghosts')" />
        <LabNumber v-model="settings.diffusion" label="Diffusion" v-bind="range('diffusion')" />
        <LabNumber v-model="settings.starIntensity" label="Star" v-bind="range('starIntensity')" />

        <!--
          The star's shape, only once there is one. Three numbers that decide
          nothing are three ways to doubt the panel describes the frame.
        -->
        <template v-if="settings.starIntensity > 0">
          <LabNumber v-model="settings.starPoints" label="Points" v-bind="range('starPoints')" />
          <LabNumber v-model="settings.starLength" label="Reach" v-bind="range('starLength')" />
          <LabNumber v-model="settings.starAngle" label="Star angle" v-bind="range('starAngle')" />
        </template>

        <p v-if="settings.bloomIntensity <= 0" class="mt-2 font-mono text-[10px] leading-relaxed text-dimmed/70">
          Everything below the glow is spilled light, so it needs some glow to
          spill. Raise it above zero.
        </p>
      </LabSection>

      <!--
        Its own section, because these are the four things glass does to a picture and they compose:
        the bulge bends where every channel is read from, and the split, the spectrum and the
        scatter decide how far apart those reads land.
      -->
      <LabSection title="Lens">
        <LabNumber v-model="settings.distortion" label="Bulge" v-bind="range('distortion')" />
        <LabNumber v-model="settings.aberration" label="Colour spread" v-bind="range('aberration')" />
        <LabNumber v-model="settings.dispersion" label="Dispersion" v-bind="range('dispersion')" />
        <LabNumber v-model="settings.lensNoise" label="Scatter" v-bind="range('lensNoise')" />
        <LabNumber v-model="settings.radialBlur" label="Zoom blur" v-bind="range('radialBlur')" />
        <LabNumber v-model="settings.spinBlur" label="Spin blur" v-bind="range('spinBlur')" />

        <p v-if="!hasSpread" class="mt-2 font-mono text-[10px] leading-relaxed text-dimmed/70">
          Dispersion and scatter both act on the colour spread, so they do
          nothing until there is some.
        </p>
      </LabSection>

      <LabSection title="Grade">
        <LabNumber v-model="settings.exposure" label="Exposure" v-bind="range('exposure')" />
        <LabNumber v-model="settings.contrast" label="Contrast" v-bind="range('contrast')" />
        <LabNumber v-model="settings.saturation" label="Saturation" v-bind="range('saturation')" />
        <LabNumber v-model="settings.attenuation" label="Distance falloff" v-bind="range('attenuation')" />
        <LabNumber v-model="settings.vignette" label="Vignette" v-bind="range('vignette')" />
        <LabNumber v-model="settings.grain" label="Grain" v-bind="range('grain')" />
        <LabToggle v-model="settings.tonemap" label="Filmic tonemap" />

        <!--
          No alpha here, and on the two duotone stops below. All three are read
          by `hexToLinearRgb`, which takes six digits — and the backdrop of a
          frame is not a thing that can be see-through anyway.
        -->
        <div class="mt-2">
          <LabColour v-model="settings.background" label="Background" :alpha="false" />
        </div>

        <div class="mt-3 mb-1 font-pixel text-[10px] uppercase tracking-[0.18em] text-dimmed">
          Duotone
        </div>
        <LabNumber v-model="settings.duotone" label="Amount" v-bind="range('duotone')" />
        <!--
          Only offered once there is something to colour. Two swatches above a
          control set to zero are two decisions nobody has been asked to make.
        -->
        <div v-if="settings.duotone > 0" class="mt-2 flex flex-col gap-2">
          <LabColour v-model="settings.duotoneShadow" label="Shadow" :alpha="false" />
          <LabColour v-model="settings.duotoneHighlight" label="Highlight" :alpha="false" />
        </div>

      </LabSection>


      <!--
        Last, because it is the last thing that happens to the picture — and
        because it is the one control here that can throw the rest away. Every
        screen reads one value per cell, so a shot graded for its highlights and
        then reduced to five glyphs has spent that grade on nothing.
      -->
      <LabSection title="Stylize">
        <LabChoice
          label="Screen"
          hint="Redraws the finished frame on a grid. One at a time — two screens fighting over the same cell is mush."
          :options="STYLIZE_OPTIONS"
          :model-value="settings.stylize"
          cards
          @update:model-value="setScreen(String($event) as StylizeMode)"
        />

        <template v-if="settings.stylize !== 'none'">
          <LabNumber
            v-model="settings.stylizeScale"
            label="Cell size"
            v-bind="{ ...range('stylizeScale'), min: minCell }"
          />
          <LabNumber
            v-if="settings.stylize === 'dither' || settings.stylize === 'posterize'"
            v-model="settings.stylizeLevels"
            label="Levels"
            v-bind="range('stylizeLevels')"
          />
          <LabNumber
            v-if="settings.stylize === 'halftone'"
            v-model="settings.stylizeAngle"
            label="Screen angle"
            v-bind="range('stylizeAngle')"
          />
          <LabNumber v-model="settings.stylizeColour" label="Keep colour" v-bind="range('stylizeColour')" />
          <LabNumber v-model="settings.stylizeMask" label="Confine to" v-bind="range('stylizeMask')" />

          <p class="mt-1 font-mono text-[10px] leading-relaxed text-dimmed/70">
            {{ settings.stylizeMask > 0.02
              ? 'Only the highlights are screened; the rest stays as photographed.'
              : settings.stylizeMask < -0.02
                ? 'Only the shadows are screened.'
                : 'The whole frame is screened.' }}
          </p>

          <LabChoice
            v-if="settings.stylize === 'ascii'"
            label="Glyphs"
            :options="ASCII_OPTIONS"
            :model-value="settings.asciiSet"
            @update:model-value="settings.asciiSet = String($event) as AsciiSet"
          />
        </template>
      </LabSection>

      <LabSection title="Output">
        <LabChoice
          label="Size"
          :options="OUTPUT_OPTIONS"
          :model-value="activeOutput"
          cards
          @update:model-value="setOutput(String($event))"
        />

        <!--
          A shot is one frame: it has no rate, no speed, no container and nothing to hold after it
          ends, and four controls that decide nothing are four ways to doubt that the panel is
          describing the thing on screen.
        -->
        <template v-if="mode === 'video'">
          <LabChoice
            label="Frame rate"
            :options="RATE_OPTIONS"
            :model-value="settings.fps"
            @update:model-value="settings.fps = Number($event)"
          />

          <LabChoice
            label="Speed"
            :hint="HINTS.speed"
            :options="SPEED_OPTIONS"
            :model-value="settings.speed"
            @update:model-value="settings.speed = Number($event)"
          />

          <LabChoice
            label="File"
            :options="CONTAINERS"
            :model-value="settings.container"
            cards
            @update:model-value="settings.container = String($event)"
          />

          <LabNumber v-model="settings.tail" label="Tail" v-bind="range('tail')" />
        </template>

        <!--
          The size is here rather than on a control: with the presets doing the
          setting, this is the only place the pixels are stated, and a shot out of
          an old link that matches no preset would otherwise never say its own
          frame size out loud.
        -->
        <p class="mt-2 font-mono text-[10px] leading-relaxed text-dimmed/70">
          <template v-if="mode === 'video'">
            {{ settings.outputWidth }}×{{ settings.outputHeight }} · {{ frameCount }} frames ·
            {{ segmentSeconds }}s of animation → {{ outputSeconds }}s of video
          </template>
          <template v-else>
            {{ settings.outputWidth }}×{{ settings.outputHeight }} · one frame, rendered at
            twice that and resolved down
          </template>
        </p>
      </LabSection>
    </div>

    <footer class="border-t border-default p-3 @min-[280px]:p-4">
      <div v-if="busy" class="mb-2">
        <!--
          scaleX rather than an animated width. A width transition is a layout
          animation driven by the main thread — which spends the whole export
          blocked in long synchronous captures, so the bar lurches and appears to
          slip backwards. A transform is composited and set outright, so it only
          ever moves forward, at exactly the rate progress does.
        -->
        <div class="h-[3px] w-full overflow-hidden bg-elevated">
          <div
            class="h-full origin-left bg-primary-500"
            :style="{ transform: `scaleX(${progress})` }"
          />
        </div>
        <div class="mt-2 flex items-center justify-between">
          <span class="font-mono text-[10px] text-dimmed">{{ Math.round(progress * 100) }}%</span>
          <button
            type="button"
            data-cuelume-press
            class="font-mono text-[10px] text-dimmed hover:text-error transition-colors"
            @click="emit('cancel')"
          >
            cancel
          </button>
        </div>
      </div>

      <div v-else class="flex gap-1">
        <!--
          A shot exports one frame, so copying it is the whole of what this row
          does and it takes the width the take's export would have had.
        -->
        <button
          v-if="mode === 'video'"
          type="button"
          data-cuelume-press
          class="flex-1 border border-primary-500/50 bg-primary-500/10 py-[7px] font-mono text-[10px] text-primary hover:bg-primary-500/20 transition-colors"
          @click="emit('exportVideo')"
        >
          export {{ settings.container }}
        </button>
        <!--
          Copying is the wide one because a still off this thing is nearly always
          on its way into a post or a message, and a file on disk is a detour
          through the finder to get there. Saving one is still a real errand
          though, so it keeps a button rather than a menu item — an action behind
          an ellipsis is an action nobody finds twice.
        -->
        <button
          type="button"
          data-cuelume-press
          class="border px-3 py-[7px] font-mono text-[10px] transition-colors"
          :class="[
            mode === 'shot' ? 'flex-1' : '',
            pngCopied
              ? 'border-primary-500/50 text-primary'
              : 'border-muted text-muted hover:border-accented hover:text-default',
          ]"
          title="Copy the frame to the clipboard"
          @click="emit('copyPng')"
        >
          {{ pngCopied ? 'copied' : 'copy png' }}
        </button>
        <button
          type="button"
          data-cuelume-press
          class="flex items-center border border-muted px-2 py-[7px] text-muted transition-colors hover:border-accented hover:text-default"
          aria-label="Download the frame as a PNG"
          title="Download the frame as a PNG"
          @click="emit('exportPng')"
        >
          <UIcon name="i-lucide-download" class="block size-3" />
        </button>
      </div>

      <p class="mt-3 font-mono text-[9px] leading-relaxed text-dimmed/55">
        stage {{ captureMs.toFixed(0) }}ms<span v-if="!highPrecision"> · 8-bit targets, bloom will be flatter</span>
      </p>
    </footer>
  </aside>
</template>
