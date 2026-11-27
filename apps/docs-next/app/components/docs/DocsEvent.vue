<script setup lang="ts">
import type { EventView } from '~/composables/useEventRail'

const props = defineProps<{
  scenario: string
  /** Index of the step to show. Lines the step added are marked. */
  step: number
  view: EventView
}>()

const steps = computed(() => eventScenarios[props.scenario]?.steps ?? [])
const current = computed(() => steps.value[props.step])
const lines = computed(() => {
  if (!current.value) return []
  return props.view === 'json' ? jsonLines(steps.value, props.step) : prettyLines(steps.value, props.step)
})
</script>

<template>
  <p v-if="current?.dropped" class="px-4 py-3.5 font-mono text-[12.5px]/[1.75] text-dimmed">
    {{ current.dropped }}
  </p>
  <pre
    v-else
    :key="view"
    class="docs-event py-3.5 font-mono text-[12.5px]/[1.75]"
    :aria-label="`Event after ${current?.label}`"
  ><span
    v-for="(line, at) in lines"
    :key="line.key"
    class="event-line"
    :style="{ '--i': at }"
    :data-added="line.added || undefined"
  ><span
    v-for="(span, i) in line.spans"
    :key="i"
    :class="[eventToneClass[span.tone], span.bold ? 'font-medium' : '']"
  >{{ span.text }}</span>{{ line.spans.length ? '' : ' ' }}</span></pre>
</template>

<style scoped>
/* A long line wraps under its own value, as it would in a narrow terminal, so nothing scrolls sideways. */
.event-line {
  display: block;
  padding: 0 1rem 0 calc(1rem + 5ch);
  text-indent: -5ch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  position: relative;
}

/* Blue means added: the lines this step put on the event. */
.event-line[data-added] {
  background: color-mix(in srgb, var(--d-signal) 7%, transparent);
}

.event-line[data-added]::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: var(--d-signal);
  transform-origin: top;
}

/* The event prints line by line the first time it scrolls into view, and again when the view changes. */
[data-reveal='armed'] .event-line {
  opacity: 0;
}

[data-reveal='run'] .event-line {
  animation: event-line-in 380ms var(--d-ease) both;
  animation-delay: calc(min(var(--i), 14) * 24ms);
}

/* Each added line draws its piece of the bar once it has printed, so the bar grows down the event. */
[data-reveal='run'] .event-line[data-added]::before {
  animation: event-bar-in 260ms var(--d-ease) both;
  animation-delay: calc(min(var(--i), 14) * 24ms + 240ms);
}

@keyframes event-bar-in {
  from {
    transform: scaleY(0);
  }
}

@keyframes event-line-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-reveal='run'] .event-line,
  [data-reveal='run'] .event-line[data-added]::before {
    animation: none;
  }
}
</style>
