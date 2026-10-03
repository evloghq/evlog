<script setup lang="ts">
/**
 * Properties of the selected layer.
 *
 * Geometry is in fractions of the stage rather than pixels, so a composition
 * survives a change of stage size instead of scattering — the same reason the
 * camera is expressed as a zoom rather than a distance.
 */

import { FONT_CATALOGUE, MAX_LAYER_SPEED, MIN_LAYER_SPEED, canChangeLayerSpeed, layerDurationForSourceEnd, layerSpeed, withLayerSpeed } from '~/utils/lab/layers'
import type { Layer } from '~/utils/lab/layers'
import { ENTRIES } from '~/utils/lab/registry'

const props = defineProps<{
  layer: Layer
  timelineLength: number
  /**
   * Length this clip's animation declares, in ms.
   *
   * Absent for media, and for the components that drive themselves without the
   * shared sequencer — there is nothing to ask them.
   */
  sequenceMs?: number
}>()

const emit = defineEmits<{
  update: [patch: Partial<Layer>]
  remove: []
  duplicate: []
}>()

/**
 * What fitting would set the length to, or null when it would change nothing.
 *
 * What is left of the cycle after the trim, not the whole of it: a clip starting
 * two seconds in has two seconds less to run.
 */
const fitLength = computed(() => {
  if (!props.sequenceMs) return null
  const length = layerDurationForSourceEnd(props.layer, props.sequenceMs)
  return Math.abs(length - props.layer.duration) < 50 ? null : length
})

function setSpeed(speed: number) {
  const updated = withLayerSpeed(props.layer, speed)
  emit('update', { duration: updated.duration, speed: updated.speed })
}

const KINDS = {
  component: { label: 'animation', icon: 'i-lucide-square-play' },
  video: { label: 'video', icon: 'i-lucide-film' },
  image: { label: 'image', icon: 'i-lucide-image' },
  text: { label: 'text', icon: 'i-lucide-type' },
} as const

/**
 * Every face, each written in itself.
 *
 * A list of names set in the panel's own font is a list of words you have to
 * try one by one. Set in the face they name, the list is the specimen — which
 * is how every editor that takes type seriously presents this, and the only
 * way to pick one without a round trip through the canvas.
 */
const FONTS = FONT_CATALOGUE

/**
 * Ceiling for a clip's own span.
 *
 * Deliberately not the timeline's length: the timeline is derived from the
 * clips, so capping a clip at it means a clip can only ever shrink. There would
 * be no value left to type that makes it longer.
 */
const MAX_SPAN = 120_000

const SPACES = [
  { value: 'plate', label: 'on plate', hint: 'Sits on the animation and takes its tilt' },
  { value: 'scene', label: 'in scene', hint: 'Floats at its own depth' },
  { value: 'overlay', label: 'overlay', hint: 'Flat on the frame, outside the camera' },
] as const

const groupedEntries = computed(() => {
  const groups = new Map<string, typeof ENTRIES>()
  for (const entry of ENTRIES) {
    const list = groups.get(entry.group) ?? []
    list.push(entry)
    groups.set(entry.group, list)
  }
  return Array.from(groups, ([group, entries]) => ({ group, entries }))
})

const TEXT_FITS = [
  { value: 'auto' as const, label: 'auto width', hint: 'The box hugs the words. Drag a corner to size the type.' },
  { value: 'fixed' as const, label: 'column', hint: 'The width is set and the text wraps into it.' },
]

const DECORATIONS = [
  { value: 'none' as const, label: 'none', style: '' },
  { value: 'underline' as const, label: 'underline', style: 'underline' },
  { value: 'strikethrough' as const, label: 'strike', style: 'line-through' },
]

const ALIGNMENTS = [
  { value: 'left', icon: 'i-lucide-align-left' },
  { value: 'center', icon: 'i-lucide-align-center' },
  { value: 'right', icon: 'i-lucide-align-right' },
] as const

/**
 * Each button is set the way it sets the text.
 *
 * An italic button in italics and a caps button in caps need no label read to be
 * understood, and they double as a preview of what the type will do.
 */
const TEXT_TOGGLES = [
  { key: 'italic', label: 'Italic', style: 'font-style: italic' },
  { key: 'uppercase', label: 'CAPS', style: 'letter-spacing: 0.1em' },
] as const
</script>

<template>
  <LabSection :title="`Editing ${KINDS[layer.kind].label}`">
    <!--
      What is selected, stated rather than implied. The panel used to open on a
      bare text field and you had to work out from its contents whether you were
      editing an image, a title or the animation.
    -->
    <div class="mb-2 flex items-center gap-2 border border-primary-500/40 bg-primary-500/10 px-2 py-1.5">
      <UIcon :name="KINDS[layer.kind].icon" class="size-3.5 shrink-0 text-primary" />
      <input
        :value="layer.name"
        type="text"
        class="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-highlighted outline-none"
        @input="emit('update', { name: ($event.target as HTMLInputElement).value })"
      >
    </div>

    <!--
      Which built-in animation this layer stages. It lives here rather than in a
      global Source section because a project can hold several, or none.
    -->
    <select
      v-if="layer.kind === 'component'"
      :value="layer.component"
      class="mb-2 w-full border border-muted bg-elevated/40 px-2 py-1.5 font-mono text-[11px] text-default outline-none focus:border-accented"
      @change="emit('update', {
        component: ($event.target as HTMLSelectElement).value,
        name: ($event.target as HTMLSelectElement).value,
      })"
    >
      <optgroup v-for="group in groupedEntries" :key="group.group" :label="group.group">
        <option v-for="entry in group.entries" :key="entry.name" :value="entry.name">
          {{ entry.label }}
        </option>
      </optgroup>
    </select>

    <template v-if="layer.kind === 'text'">
      <textarea
        :value="layer.text"
        rows="2"
        class="mb-2 w-full resize-none border border-muted bg-elevated/40 px-2 py-1.5 font-mono text-[11px] text-default outline-none focus:border-accented"
        @input="emit('update', { text: ($event.target as HTMLTextAreaElement).value })"
      />

      <div class="mb-2 grid grid-cols-2 gap-1 @min-[320px]:grid-cols-3">
        <button
          v-for="font in FONTS"
          :key="font.value"
          type="button"
          data-cuelume-press
          class="truncate border px-1.5 py-1 text-[11px] leading-tight transition-colors"
          :class="(layer.font ?? 'pixel') === font.value
            ? 'border-primary-500/60 text-primary'
            : 'border-muted text-dimmed hover:border-accented hover:text-toned'"
          :style="{ fontFamily: `var(${font.variable}, ${font.fallback})` }"
          :title="font.label"
          @click="emit('update', { font: font.value })"
        >
          {{ font.label }}
        </button>
      </div>

      <div class="mb-2 flex items-center gap-1">
        <button
          v-for="alignment in ALIGNMENTS"
          :key="alignment.value"
          type="button"
          class="flex flex-1 items-center justify-center border py-1 transition-colors"
          :class="(layer.align ?? 'center') === alignment.value
            ? 'border-primary-500/60 text-primary'
            : 'border-muted text-dimmed hover:border-accented hover:text-toned'"
          @click="emit('update', { align: alignment.value })"
        >
          <UIcon :name="alignment.icon" class="size-3" />
        </button>
      </div>

      <div class="mb-2">
        <LabColour
          label="Colour"
          :model-value="layer.color ?? '#ffffff'"
          @update:model-value="emit('update', { color: $event })"
        />
      </div>

      <!--
        Which of the two decides the other. Auto hugs the words and the box is
        dragged to size them; fixed sets a column and the type flows into it.
      -->
      <div class="mb-2 flex gap-1">
        <button
          v-for="fit in TEXT_FITS"
          :key="fit.value"
          type="button"
          data-cuelume-press
          class="flex-1 border py-1 font-mono text-[10px] transition-colors"
          :class="(layer.textFit ?? 'auto') === fit.value
            ? 'border-primary-500/60 text-primary'
            : 'border-muted text-dimmed hover:border-accented hover:text-toned'"
          :title="fit.hint"
          @click="emit('update', { textFit: fit.value })"
        >
          {{ fit.label }}
        </button>
      </div>

      <!--
        Only in a column. Hugging text takes its size from the box, so a second
        size control would be a slider that moves nothing you can see — the
        width below is the one that sizes it.
      -->
      <LabNumber
        v-if="(layer.textFit ?? 'auto') === 'fixed'"
        :model-value="layer.fontSize ?? 0.12"
        label="Size"
        :min="0.01"
        :max="0.6"
        :step="0.002"
        :default="0.12"
        @update:model-value="emit('update', { fontSize: $event })"
      />
      <LabNumber
        :model-value="layer.weight ?? 500"
        label="Weight"
        :min="100"
        :max="900"
        :step="100"
        :default="500"
        @update:model-value="emit('update', { weight: $event })"
      />
      <LabNumber
        :model-value="layer.lineHeight ?? 1.15"
        label="Line height"
        hint="Space between lines, as a multiple of the size. Tighten it as type gets bigger."
        :min="0.7"
        :max="2.5"
        :step="0.01"
        :default="1.15"
        @update:model-value="emit('update', { lineHeight: $event })"
      />
      <LabNumber
        :model-value="layer.letterSpacing ?? 0"
        label="Tracking"
        hint="Space between letters, in ems. Large type usually wants a little less than none."
        :min="-0.1"
        :max="0.5"
        :step="0.005"
        :default="0"
        @update:model-value="emit('update', { letterSpacing: $event })"
      />

      <!-- Two switches rather than two rows: they are on or off, not a value. -->
      <div class="mb-2 mt-1 flex gap-1">
        <button
          v-for="toggle in TEXT_TOGGLES"
          :key="toggle.key"
          type="button"
          class="flex-1 border py-1 font-mono text-[10px] transition-colors"
          :class="layer[toggle.key]
            ? 'border-primary-500/60 text-primary'
            : 'border-muted text-dimmed hover:border-accented hover:text-toned'"
          :style="toggle.style"
          @click="emit('update', { [toggle.key]: !layer[toggle.key] })"
        >
          {{ toggle.label }}
        </button>
      </div>

      <div class="mb-2 flex gap-1">
        <button
          v-for="rule in DECORATIONS"
          :key="rule.value"
          type="button"
          data-cuelume-press
          class="flex-1 border py-1 font-mono text-[10px] transition-colors"
          :class="[
            (layer.decoration ?? 'none') === rule.value
              ? 'border-primary-500/60 text-primary'
              : 'border-muted text-dimmed hover:border-accented hover:text-toned',
            rule.style,
          ]"
          @click="emit('update', { decoration: rule.value })"
        >
          {{ rule.label }}
        </button>
      </div>

      <!--
        A cast shadow, which the glow cannot be: glow is centred on the glyphs
        by construction. The offsets only appear once there is a shadow to move.
      -->
      <LabNumber
        :model-value="layer.shadow ?? 0"
        label="Shadow"
        :min="0"
        :max="1"
        :step="0.005"
        :default="0"
        @update:model-value="emit('update', { shadow: $event })"
      />
      <template v-if="(layer.shadow ?? 0) > 0">
        <LabNumber
          :model-value="layer.shadowX ?? 0"
          label="Shadow X"
          :min="-1"
          :max="1"
          :step="0.005"
          :default="0"
          @update:model-value="emit('update', { shadowX: $event })"
        />
        <LabNumber
          :model-value="layer.shadowY ?? 0"
          label="Shadow Y"
          :min="-1"
          :max="1"
          :step="0.005"
          :default="0"
          @update:model-value="emit('update', { shadowY: $event })"
        />
        <div class="mb-2">
          <LabColour
            label="Shadow colour"
            :model-value="layer.shadowColor ?? '#000000cc'"
            @update:model-value="emit('update', { shadowColor: $event })"
          />
        </div>
      </template>

      <LabNumber
        :model-value="layer.glow ?? 0"
        label="Glow"
        hint="A halo in the text's own colour, baked into the layer — unlike bloom, which lifts the whole frame."
        :min="0"
        :max="1"
        :step="0.01"
        :default="0"
        @update:model-value="emit('update', { glow: $event })"
      />
      <LabNumber
        :model-value="layer.stroke ?? 0"
        label="Outline"
        hint="Width of the outline, as a fraction of the size. What keeps a title readable over a busy plate."
        :min="0"
        :max="0.3"
        :step="0.005"
        :default="0"
        @update:model-value="emit('update', { stroke: $event })"
      />
      <div v-if="(layer.stroke ?? 0) > 0" class="mb-2">
        <LabColour
          label="Outline colour"
          :model-value="layer.strokeColor ?? '#000000'"
          @update:model-value="emit('update', { strokeColor: $event })"
        />
      </div>
    </template>

    <!--
      Where the layer lives. Plate rides on the animation's surface and takes its
      tilt; scene floats at its own depth; overlay skips the camera entirely.
    -->
    <div class="mb-2 flex gap-1">
      <button
        v-for="space in SPACES"
        :key="space.value"
        type="button"
        class="flex-1 border py-1 font-mono text-[10px] transition-colors"
        :class="(layer.space ?? 'scene') === space.value
          ? 'border-primary-500/60 text-primary'
          : 'border-muted text-dimmed hover:border-accented hover:text-toned'"
        :title="space.hint"
        @click="emit('update', { space: space.value })"
      >
        {{ space.label }}
      </button>
    </div>

    <LabNumber
      :model-value="layer.x"
      label="X"
      :min="-0.5"
      :max="1.5"
      :step="0.002"
      :default="0.5"
      @update:model-value="emit('update', { x: $event })"
    />
    <LabNumber
      :model-value="layer.y"
      label="Y"
      :min="-0.5"
      :max="1.5"
      :step="0.002"
      :default="0.5"
      @update:model-value="emit('update', { y: $event })"
    />
    <LabNumber
      v-if="(layer.space ?? 'scene') === 'scene'"
      :model-value="layer.depth"
      label="Depth"
      :min="-2"
      :max="2"
      :step="0.005"
      :default="-0.35"
      @update:model-value="emit('update', { depth: $event })"
    />
    <LabNumber
      :model-value="layer.width"
      label="Width"
      :min="0.02"
      :max="2"
      :step="0.002"
      :default="0.5"
      @update:model-value="emit('update', { width: $event })"
    />
    <LabNumber
      :model-value="layer.rotation"
      label="Rotation"
      :min="-180"
      :max="180"
      :step="0.5"
      unit="°"
      :default="0"
      @update:model-value="emit('update', { rotation: $event })"
    />
    <LabNumber
      :model-value="layer.opacity"
      label="Opacity"
      :min="0"
      :max="1"
      :step="0.005"
      :default="1"
      @update:model-value="emit('update', { opacity: $event })"
    />

    <LabNumber
      :model-value="layer.start"
      label="Start"
      :min="0"
      :max="MAX_SPAN"
      :step="10"
      unit="ms"
      :default="0"
      @update:model-value="emit('update', { start: $event })"
    />
    <LabNumber
      v-if="canChangeLayerSpeed(layer)"
      :model-value="layerSpeed(layer)"
      label="Speed"
      hint="Playback rate. Faster playback shortens the clip without changing its source out-point."
      :min="MIN_LAYER_SPEED"
      :max="MAX_LAYER_SPEED"
      :step="0.05"
      unit="×"
      :default="1"
      @update:model-value="setSpeed"
    />
    <LabNumber
      :model-value="layer.duration"
      label="Length"
      :min="100"
      :max="MAX_SPAN"
      :step="10"
      unit="ms"
      :default="2000"
      @update:model-value="emit('update', { duration: $event })"
    />

    <!--
      Offered rather than applied. A new clip is cut to its animation on the way
      in, but once it is on the timeline its length is an edit — swapping the
      component underneath must not silently undo a trim, so the fit waits to be
      asked for and says what it would give you.
    -->
    <button
      v-if="fitLength !== null"
      type="button"
      class="mb-2 w-full border border-muted py-1 font-mono text-[10px] text-muted transition-colors hover:border-primary-500/50 hover:text-primary"
      :title="`This animation runs ${((sequenceMs ?? 0) / 1000).toFixed(1)}s in full.`"
      @click="emit('update', { duration: fitLength })"
    >
      fit to the animation · {{ (fitLength / 1000).toFixed(1) }}s
    </button>
    <LabEffects
      :effects="layer.effects ?? []"
      empty-label="No animation — the media cuts in and out."
      @update="emit('update', { effects: $event })"
    />

    <div class="mt-2 flex gap-1">
      <button
        type="button"
        class="flex-1 border border-muted py-1.5 font-mono text-[10px] text-muted transition-colors hover:border-accented hover:text-default"
        @click="emit('duplicate')"
      >
        duplicate
      </button>
      <button
        type="button"
        class="flex-1 border border-muted py-1.5 font-mono text-[10px] text-muted transition-colors hover:border-error/30 hover:text-error"
        @click="emit('remove')"
      >
        delete
      </button>
    </div>
  </LabSection>
</template>
