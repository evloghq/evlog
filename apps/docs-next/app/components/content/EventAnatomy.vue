<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'

type PartId = 'events' | 'errors' | 'drains' | 'audit' | 'signals' | 'map' | 'skills' | 'telemetry'

interface Line {
  /** Tree prefix, as evlog's pretty printer draws it. */
  tree: string
  key?: string
  value: string
  parts: PartId[]
}

const lines: Line[] = [
  { tree: '', value: 'POST /api/checkout 402 in 234ms', parts: ['events', 'drains', 'signals'] },
  { tree: '├─', key: 'user', value: 'id=usr_123 plan=pro', parts: ['events', 'drains'] },
  { tree: '├─', key: 'cart', value: 'items=3 total=9999', parts: ['events', 'drains'] },
  { tree: '└─', key: 'error', value: 'Payment failed', parts: ['errors', 'drains', 'signals'] },
  { tree: '    ', key: 'why', value: 'Card declined by issuer', parts: ['errors', 'drains'] },
  { tree: '    ', key: 'fix', value: 'Try a different payment method', parts: ['errors', 'drains'] },
]

interface Part {
  id: PartId
  name: string
  to: string
  text: string
}

const parts: Part[] = [
  { id: 'events', name: 'Events', to: '/events', text: 'The block is one wide event. log.set() added user and cart while the request ran, and evlog wrote them once, when the response left.' },
  { id: 'errors', name: 'Errors', to: '/errors', text: 'createError() put why and fix on the failure, so the reason travels with it to the console, the drain and the client.' },
  { id: 'drains', name: 'Drains', to: '/drains', text: 'The same event leaves the process as JSON, for Axiom, OTLP, Sentry or any backend named in evlog.config.ts.' },
  { id: 'audit', name: 'Audit', to: '/audit', text: 'Had this been a refund, log.audit() would add who did it to which invoice, and sampling would keep the event.' },
  { id: 'map', name: 'Map', to: '/map', text: 'evlog map scores each route on whether it emits an event like this one, and fails CI when a change lowers the score.' },
  { id: 'signals', name: 'Signals', to: '/signals', text: 'A model reads the status and the error and writes its answer back on the event, such as whether this 402 was the client\'s doing.' },
  { id: 'skills', name: 'Skills', to: '/skills', text: 'Agent skills that wire evlog into your code and read events like this one back when your agent debugs.' },
  { id: 'telemetry', name: 'Telemetry', to: '/telemetry', text: 'The same kind of event for a CLI run or a CI job, sent only with the user\'s consent.' },
]

const content = useDocsContent()
const active = ref<PartId>('events')

const shown = ref(0)

const { root, still } = useFigure({
  steps: lines.map((_, i) => ({ at: 150 + i * 90, run: () => {
    shown.value = i + 1
  } })),
  reset: () => {
    shown.value = 0
  },
  settle: () => {
    shown.value = lines.length
  },
})

const list = useTemplateRef<HTMLElement>('list')
const pill = reactive({ x: 0, y: 0, w: 0, h: 0, travels: false })

function measure() {
  const index = parts.findIndex(p => p.id === active.value)
  const button = list.value?.querySelectorAll<HTMLElement>('[role="tab"]')[index]
  if (!button) return
  pill.x = button.offsetLeft
  pill.y = button.offsetTop
  pill.w = button.offsetWidth
  pill.h = button.offsetHeight
}

watch(active, measure, { flush: 'post' })
useResizeObserver(list, measure)

onMounted(() => {
  measure()
  requestAnimationFrame(() => {
    pill.travels = true
  })
})

function lit(line: Line) {
  return line.parts.includes(active.value) || !lines.some(l => l.parts.includes(active.value))
}
</script>

<template>
  <DocsFigure ref="root" :finished="false" still>
    <pre
      class="overflow-x-auto px-5 pt-5 pb-4 font-mono text-[13px]/[1.85] sm:px-6"
      aria-label="A wide event as evlog prints it"
    ><span
      v-for="(line, i) in lines"
      :key="i"
      class="d-step block transition-[opacity,color] duration-200"
      :data-on="still || shown > i"
      :style="{ opacity: shown > i || still ? (lit(line) ? 1 : 0.28) : undefined }"
    ><template v-if="i === 0"><span class="text-dimmed">10:23:45.612 </span><span class="text-(--d-warn)">ERROR</span><span class="text-dimmed"> [shop] </span><span class="text-highlighted">POST /api/checkout </span><span class="text-(--d-warn)">402</span><span class="text-dimmed"> in </span><span class="text-highlighted">234ms</span></template><template v-else><span class="text-dimmed">  {{ line.tree }} </span><span class="text-muted">{{ line.key }}:</span> <span class="text-default">{{ line.value }}</span></template></span></pre>

    <div class="border-t border-(--d-line) px-5 pt-4 pb-5 sm:px-6">
      <div ref="list" role="tablist" aria-label="Parts of evlog" class="relative -ml-2 flex flex-wrap gap-1">
        <span
          aria-hidden="true"
          class="absolute top-0 left-0 rounded-(--d-r-md) bg-(--d-raised-strong) ring-1 ring-(--d-line) ring-inset"
          :class="pill.travels ? 'transition-[transform,width] duration-[260ms] ease-(--d-ease)' : ''"
          :style="{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: `${pill.w}px`, height: `${pill.h}px` }"
        />
        <button
          v-for="p in parts"
          :key="p.id"
          type="button"
          role="tab"
          :aria-selected="active === p.id"
          class="relative rounded-(--d-r-md) px-2 py-1 text-[13.5px] transition-[color,transform] duration-150 active:scale-[0.97]"
          :class="active === p.id ? 'text-highlighted' : 'text-dimmed hover:text-default'"
          @pointerenter="active = p.id"
          @focus="active = p.id"
          @click="active = p.id"
        >
          {{ p.name }}
        </button>
      </div>

      <div role="tabpanel" class="d-stack mt-3 max-w-[36rem]">
        <p
          v-for="p in parts"
          :key="p.id"
          class="d-xfade text-[14px]/[1.6] text-muted"
          :data-on="active === p.id"
          :aria-hidden="active !== p.id"
        >
          {{ p.text }}
          <NuxtLink
            :to="prefixLink(p.to, content.routeBase)"
            class="ml-1 whitespace-nowrap text-highlighted underline decoration-(--d-line-strong) underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-(--d-signal-text)"
          >
            Read {{ p.name }}
          </NuxtLink>
        </p>
      </div>
    </div>
  </DocsFigure>
</template>
