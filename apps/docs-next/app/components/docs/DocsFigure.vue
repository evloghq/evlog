<script setup lang="ts">
const props = defineProps<{
  /** One sentence under the frame saying what the figure shows. */
  caption?: string
  /** Shows the replay button once the figure has played. */
  finished?: boolean
  /** Reduced motion: the figure never plays, so there is nothing to replay. */
  still?: boolean
  /** The figure is running its sequence. */
  playing?: boolean
  /** Length of the sequence in milliseconds, for the progress line. */
  duration?: number
}>()

defineEmits<{ replay: [] }>()

// The frame is what the reader sees arrive: inside a `::emits` block the figure element has no box of its own.
const frame = useTemplateRef<HTMLElement>('frame')
defineExpose({ frame })
</script>

<template>
  <figure class="d-figure not-prose my-10">
    <div ref="frame" class="d-figure-frame d-block relative overflow-hidden rounded-(--d-r-lg) border border-(--d-line) bg-(--d-raised)">
      <slot />

      <!-- Drawn on the frame's own bottom edge, like the reading progress on the top bar's hairline. -->
      <span
        v-if="props.duration"
        aria-hidden="true"
        class="d-figure-progress"
        :data-state="props.playing ? 'playing' : props.finished ? 'done' : 'idle'"
        :style="{ animationDuration: `${props.duration}ms` }"
      />
    </div>

    <div v-if="props.caption" class="d-figure-caption mt-2.5 flex items-start gap-4">
      <figcaption class="pt-0.5 text-[13px]/5 text-pretty text-dimmed">
        {{ props.caption }}
      </figcaption>
      <button
        v-if="!props.still"
        type="button"
        class="group/replay -mr-1.5 ml-auto grid size-7 shrink-0 place-items-center rounded-(--d-r-md) text-dimmed transition-[color,background-color,opacity,transform] duration-200 hover:bg-(--d-raised-strong) hover:text-highlighted active:scale-[0.94]"
        :class="props.finished ? 'opacity-100' : 'pointer-events-none opacity-0'"
        :tabindex="props.finished ? 0 : -1"
        aria-label="Play again"
        title="Play again"
        @click="$emit('replay')"
      >
        <svg viewBox="0 0 12 12" class="size-3 transition-transform duration-500 ease-(--d-ease) group-hover/replay:rotate-[-45deg]" fill="none" aria-hidden="true">
          <path d="M2 6a4 4 0 1 0 1.3-2.95M2 2v2.2h2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </figure>
</template>

<style scoped>
.d-figure-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: var(--ui-text-dimmed);
  opacity: 0;
  transform: scaleX(0);
  transform-origin: left;
  transition: opacity 400ms ease;
}

.d-figure-progress[data-state='playing'] {
  opacity: 1;
  animation-name: d-figure-progress;
  animation-timing-function: linear;
  animation-fill-mode: both;
}

.d-figure-progress[data-state='done'] {
  transform: none;
}

@keyframes d-figure-progress {
  to { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .d-figure-progress {
    display: none;
  }
}
</style>
