<script setup lang="ts">
interface SourceLine {
  text: string
  debug?: boolean
  /** The object literal gets `__source` before this closing text. */
  inject?: string
}

const source: SourceLine[] = [
  { text: 'import { log } from \'evlog\'' },
  { text: '' },
  { text: 'export function checkout(cart) {' },
  { text: '  log.debug(\'checkout\', \'building cart\')', debug: true },
  { text: '  log.info({ action: \'checkout\', total: cart.total', inject: ' })' },
  { text: '  log.debug(\'checkout\', \'starting payment\')', debug: true },
  { text: '  log.info({ action: \'paid\', amount: cart.total', inject: ' })' },
  { text: '}' },
]

const built = source
  .map((line, i) => ({ ...line, no: i + 1 }))
  .filter(line => !line.debug)

const KEYWORDS = new Set(['import', 'from', 'export', 'function'])

function tokens(text: string) {
  return [...text.matchAll(/'[^']*'|\w+|\s+|[^\w\s]/g)].map(({ 0: t, index }) => {
    if (t.startsWith('\'')) return { t, c: 'text-[#00ca52]' }
    if (KEYWORDS.has(t)) return { t, c: 'text-[#ff518d]' }
    if (text[index + t.length] === '(') return { t, c: 'text-[#c472fb]' }
    return { t, c: '' }
  })
}

const stripped = ref(false)
const shown = ref(0)
const injected = ref(false)

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [
    { at: 700, run: () => {
      stripped.value = true
    } },
    ...built.map((_, i) => ({ at: 1500 + i * 160, run: () => {
      shown.value = i + 1
    } })),
    { at: 1500 + built.length * 160 + 400, run: () => {
      injected.value = true
    } },
  ],
  reset: () => {
    stripped.value = false
    shown.value = 0
    injected.value = false
  },
  settle: () => {
    stripped.value = true
    shown.value = built.length
    injected.value = true
  },
})
</script>

<template>
  <DocsFigure
    ref="root"
    caption="vite build on one file. Both log.debug() calls are removed with their arguments; with sourceLocation on, each remaining object call gets the file and line it came from."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="border-b border-(--d-line) px-5 pt-4 pb-4 sm:px-6">
      <p class="mb-3 font-mono text-[12px] text-muted">
        src/checkout.ts
      </p>
      <pre class="overflow-x-auto overflow-y-hidden font-mono text-[12.5px]/6"><span
        v-for="(line, i) in source"
        :key="i"
        class="flex transition-opacity duration-300"
        :class="line.debug && stripped ? 'opacity-35' : ''"
      ><span class="w-7 shrink-0 text-dimmed select-none">{{ i + 1 }}</span><span
        class="whitespace-pre text-default decoration-(--d-out-error) transition-[text-decoration-color]"
        :class="line.debug ? 'line-through' : ''"
        :style="{ textDecorationColor: line.debug && stripped ? undefined : 'transparent' }"
      ><span v-for="(tok, j) in tokens(line.text + (line.inject ?? ''))" :key="j" :class="tok.c">{{ tok.t }}</span>{{ line.text ? '' : ' ' }}</span></span></pre>
    </div>

    <div class="px-5 pt-4 pb-4 sm:px-6">
      <p class="mb-3 flex items-baseline gap-4 font-mono text-[12px] text-muted">
        dist/checkout.js
        <span class="d-step ml-auto font-sans text-[13px] text-dimmed" :data-on="shown > 0">2 calls removed</span>
      </p>
      <pre class="overflow-x-auto overflow-y-hidden font-mono text-[12.5px]/6"><span
        v-for="(line, i) in built"
        :key="line.no"
        class="d-step flex"
        :data-on="shown > i"
      ><span class="w-7 shrink-0 text-dimmed select-none">{{ i + 1 }}</span><span class="whitespace-pre text-default"><span v-for="(tok, j) in tokens(line.text)" :key="j" :class="tok.c">{{ tok.t }}</span><span
        v-if="line.inject"
        class="transition-colors duration-300"
        :class="injected ? 'text-(--d-signal-text)' : 'text-transparent'"
      >, __source: <span :class="injected ? 'text-[#00ca52]' : ''">"src/checkout.ts:{{ line.no }}"</span></span><span v-for="(tok, j) in tokens(line.inject ?? '')" :key="`i${j}`" :class="tok.c">{{ tok.t }}</span>{{ line.text ? '' : ' ' }}</span></span></pre>
    </div>
  </DocsFigure>
</template>
