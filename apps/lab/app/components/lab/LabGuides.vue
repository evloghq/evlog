<script setup lang="ts">
/**
 * The graticule you compose against.
 *
 * Placing a layer by typing numbers means holding the frame in your head; every
 * editor solves that with the same furniture, so this draws it: thirds to place
 * a subject on, centre marks to align to, a safe area to keep type inside of,
 * and rulers to read a position off. None of it is ever filmed — it lives in the
 * DOM, above the canvas, and the exporter never sees it.
 *
 * Drawn in neutral white at low alpha, never in the accent colour. Blue in this
 * app means "this is the thing you are acting on"; a permanent blue lattice
 * spends that meaning on scenery, and reads as an element of the shot rather
 * than as an instrument laid over it.
 *
 * The one part of the chrome that ignores the theme, and the only file where a
 * literal `white/…` is right. Everything here is drawn over the picture, and the
 * picture's background is a setting rather than a theme — putting the panel in a
 * light theme does not make the frame white, so a lattice that followed the panel
 * would go invisible against the shot it is there to measure.
 *
 * Built from CSS percentages rather than inside an SVG viewBox so the hairlines
 * stay one device pixel and the labels stay one size, whatever the frame is
 * scaled to on screen.
 */

const props = defineProps<{
  /** Output size, in pixels — what the ruler labels count in. */
  width: number
  height: number
}>()

const THIRDS = [1 / 3, 2 / 3]

/**
 * Keep type off the edge.
 *
 * Broadcast has used a title-safe inset for decades and the habit outlived the
 * CRT: a video still gets cropped by a player chrome, a rounded phone corner or
 * a social embed, so it is a useful place to keep anything that must be read.
 */
const SAFE = 0.05

/**
 * Ruler marks on a 1-2-5 grid, in two weights.
 *
 * One tick every hundred pixels is unreadable at small sizes and useless at
 * large ones. Labelled majors give the number, unlabelled minors give the
 * spacing between them something to measure against — which is the whole job of
 * a ruler, and what a single row of identical marks cannot do.
 */
function ticksFor(size: number) {
  const rough = size / 8
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1)))
  const step = [1, 2, 5, 10].map(multiple => multiple * magnitude).find(candidate => candidate >= rough) ?? magnitude * 10

  const ticks: { at: number, value: number, major: boolean }[] = []
  for (let value = 0; value <= size; value += step / 4) {
    ticks.push({ at: value / size, value: Math.round(value), major: value % step === 0 })
  }
  return ticks
}

const columns = computed(() => ticksFor(props.width))
const rows = computed(() => ticksFor(props.height))
</script>

<template>
  <div class="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[9px] text-white/40">
    <!--
      The rulers sit on a band rather than floating on the picture. A number
      drawn straight onto a frame is legible over black and invisible over
      anything bright, which is exactly when you need to read it.

      The left band is wider than the top one because it holds the same digits
      turned on their side: a four-figure height needs room the sixteen pixels
      that suit a row of tick marks do not have.
    -->
    <div class="absolute inset-x-0 top-0 h-4 bg-black/45" />
    <div class="absolute inset-y-0 left-0 w-7 bg-black/45" />

    <div
      v-for="tick in columns"
      :key="`c${tick.value}`"
      class="absolute top-0 w-px bg-white/35"
      :class="tick.major ? 'h-2' : 'h-1'"
      :style="{ left: `${tick.at * 100}%` }"
    >
      <span v-if="tick.major && tick.value" class="absolute left-1 top-1.5 leading-none">{{ tick.value }}</span>
    </div>

    <div
      v-for="tick in rows"
      :key="`r${tick.value}`"
      class="absolute left-0 h-px bg-white/35"
      :class="tick.major ? 'w-2' : 'w-1'"
      :style="{ top: `${tick.at * 100}%` }"
    >
      <span v-if="tick.major && tick.value" class="absolute left-1 top-1 leading-none">{{ tick.value }}</span>
    </div>

    <div
      v-for="at in THIRDS"
      :key="`v${at}`"
      class="absolute inset-y-0 w-px bg-white/8"
      :style="{ left: `${at * 100}%` }"
    />
    <div
      v-for="at in THIRDS"
      :key="`h${at}`"
      class="absolute inset-x-0 h-px bg-white/8"
      :style="{ top: `${at * 100}%` }"
    />

    <div class="absolute border border-dashed border-white/14" :style="{ inset: `${SAFE * 100}%` }" />
    <span class="absolute left-[5%] top-[5%] ml-1 mt-1 leading-none text-white/25">safe</span>

    <!--
      Centre, marked on the edges instead of crossed through the middle.
      A full cross sits exactly where the subject usually is and competes with
      it; marks on the rails carry the same information and leave the frame
      alone.
    -->
    <div class="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-white/45" />
    <div class="absolute bottom-0 left-1/2 h-3 w-px -translate-x-1/2 bg-white/45" />
    <div class="absolute left-0 top-1/2 h-px w-3 -translate-y-1/2 bg-white/45" />
    <div class="absolute right-0 top-1/2 h-px w-3 -translate-y-1/2 bg-white/45" />

    <span class="absolute bottom-1 right-1.5 leading-none text-white/30">{{ width }} × {{ height }}</span>
  </div>
</template>
