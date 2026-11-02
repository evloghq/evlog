<script setup lang="ts">
import { useClipboard } from '@vueuse/core'

const props = withDefaults(defineProps<{
  /** Returns the text to copy, read at click time. */
  source:() => string | Promise<string>
  /** What the button copies, e.g. `Copy page`. */
  label?: string
}>(), { label: 'Copy' })

const { copy, copied } = useClipboard({ copiedDuring: 1600 })

async function run() {
  await copy(await props.source())
}
</script>

<template>
  <button
    type="button"
    class="relative inline-flex h-7 items-center rounded-(--d-r-md) px-2 text-[12.5px] text-dimmed transition-[color,background-color,transform] duration-150 hover:bg-(--d-raised-strong) hover:text-highlighted active:scale-[0.96]"
    :aria-label="copied ? 'Copied' : props.label"
    @click="run"
  >
    <span class="d-stack items-center" aria-hidden="true">
      <span class="d-copy-label" :data-on="!copied">{{ props.label }}</span>
      <span class="d-copy-label inline-flex items-center gap-1.5 text-highlighted" :data-on="copied">
        <svg viewBox="0 0 12 12" class="size-3" fill="none">
          <path
            d="M2.5 6.4 4.9 8.7 9.5 3.6"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            pathLength="1"
            class="d-copy-check"
            :data-on="copied"
          />
        </svg>
        Copied
      </span>
    </span>
  </button>
</template>

<style scoped>
.d-copy-label {
  justify-self: end;
  transition: opacity 200ms var(--d-ease), filter 200ms var(--d-ease), transform 200ms var(--d-ease);
}

.d-copy-label[data-on='false'] {
  opacity: 0;
  filter: blur(2px);
  transform: translateY(3px);
}

.d-copy-check {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
}

.d-copy-check[data-on='true'] {
  stroke-dashoffset: 0;
  transition: stroke-dashoffset 260ms var(--d-ease) 80ms;
}

@media (prefers-reduced-motion: reduce) {
  .d-copy-label[data-on='false'] {
    transform: none;
  }
}
</style>
