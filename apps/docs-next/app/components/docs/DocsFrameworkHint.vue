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
    <p data-fw-none class="mb-8 flex items-center justify-between gap-4 rounded-(--d-r-md) py-2 pr-2 pl-3.5 ring-1 ring-(--d-line) ring-inset">
      <span class="text-dimmed">Show every example in these docs for {{ label }}</span>
      <button type="button" class="shrink-0 rounded-[6px] bg-(--d-raised-strong) px-2.5 py-1 text-default transition-[color,transform] duration-150 hover:text-highlighted active:scale-[0.97]" @click="choose(framework)">
        Use {{ label }}
      </button>
    </p>
    <p :data-fw-other="framework" class="mb-8 flex items-center justify-between gap-4 rounded-(--d-r-md) py-2 pr-2 pl-3.5 ring-1 ring-(--d-line) ring-inset">
      <span class="text-dimmed">
        The rest of the docs show
        <template v-for="f in frameworks" :key="f.id">
          <span :data-fw-only="f.id" class="text-muted">{{ f.label }}</span>
        </template>
        examples
      </span>
      <button type="button" class="shrink-0 rounded-[6px] bg-(--d-raised-strong) px-2.5 py-1 text-default transition-[color,transform] duration-150 hover:text-highlighted active:scale-[0.97]" @click="choose(framework)">
        Switch to {{ label }}
      </button>
    </p>
  </div>
</template>
