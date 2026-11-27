<script setup lang="ts">
import { frameworks } from '~/utils/frameworks'

const props = defineProps<{ framework: string }>()

const { choose } = useFrameworkChoice()
const label = computed(() => frameworks.find(f => f.id === props.framework)?.label)
</script>

<!-- On a framework's own page: offer it as the site-wide choice. Which line shows is decided by the
     before-paint `data-fw-*` CSS, and nothing shows once this framework is the choice. -->
<template>
  <div class="text-[13.5px]">
    <p data-fw-none class="mb-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span class="text-dimmed">Show every example in these docs for {{ label }}</span>
      <button type="button" class="shrink-0 text-highlighted underline decoration-(--d-line-strong) decoration-1 underline-offset-[5px] transition-[text-decoration-color] duration-150 hover:decoration-(--d-signal-text)" @click="choose(framework)">
        Use {{ label }}
      </button>
    </p>
    <p :data-fw-other="framework" class="mb-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span class="text-dimmed">
        The rest of the docs show
        <template v-for="f in frameworks" :key="f.id">
          <span :data-fw-only="f.id" class="text-muted">{{ f.label }}</span>
        </template>
        examples
      </span>
      <button type="button" class="shrink-0 text-highlighted underline decoration-(--d-line-strong) decoration-1 underline-offset-[5px] transition-[text-decoration-color] duration-150 hover:decoration-(--d-signal-text)" @click="choose(framework)">
        Switch to {{ label }}
      </button>
    </p>
  </div>
</template>
