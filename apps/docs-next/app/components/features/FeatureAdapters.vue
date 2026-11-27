<script setup lang="ts">
import { Motion } from 'motion-v'

const prefersReducedMotion = ref(false)
const containerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()

const adapters = [
  { name: 'Axiom', icon: 'i-custom-axiom' },
  { name: 'OTLP', icon: 'i-simple-icons-opentelemetry' },
  { name: 'Sentry', icon: 'i-simple-icons-sentry' },
  { name: 'PostHog', icon: 'i-simple-icons-posthog' },
  { name: 'Better Stack', icon: 'i-simple-icons-betterstack' },
]

const props = defineProps<{
  link?: string
  linkLabel?: string
}>()

const pills = [
  { label: 'Batching', icon: 'i-lucide-layers' },
  { label: 'Retry & backoff', icon: 'i-lucide-refresh-cw' },
  { label: 'Fan-out', icon: 'i-lucide-git-fork' },
]

let animId: number | undefined
let resizeObs: ResizeObserver | undefined

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  requestAnimationFrame(() => setupCanvas())
})

onBeforeUnmount(() => {
  if (animId !== undefined) cancelAnimationFrame(animId)
  resizeObs?.disconnect()
})

type Pt = { x: number; y: number }
interface NodeRect { cx: number; top: number; bottom: number }
interface Paths {
  trunk: Pt[]
  trunk2: Pt[]
  branches: Pt[][]
  hubCenter: Pt
  hubR: number
}

function setupCanvas() {
  const canvas = canvasRef.value
  const ctr = containerRef.value
  if (!canvas || !ctr) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  function parseBlue500(): readonly [number, number, number] {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-blue-500').trim()
    if (raw.startsWith('#') && raw.length >= 7) {
      const h = raw.slice(1, 7)
      return [
        Number.parseInt(h.slice(0, 2), 16),
        Number.parseInt(h.slice(2, 4), 16),
        Number.parseInt(h.slice(4, 6), 16),
      ] as const
    }
    return [40, 83, 255] as const
  }

  const [blueR, blueG, blueB] = parseBlue500()
  const borderMuted
    = getComputedStyle(document.documentElement).getPropertyValue('--ui-border-muted').trim() || '#3f3f46'

  let w = 0
  let h = 0
  let P: Paths | null = null

  function rel(el: Element | null): NodeRect {
    const cr = ctr.getBoundingClientRect()
    if (!el) return { cx: 0, top: 0, bottom: 0 }
    const r = el.getBoundingClientRect()
    return {
      cx: r.left - cr.left + r.width / 2,
      top: r.top - cr.top,
      bottom: r.bottom - cr.top,
    }
  }

  function measure() {
    const hub = rel(ctr.querySelector('[data-node="evlog"]'))
    const a = adapters.map((_, i) => rel(ctr.querySelector(`[data-adapter="${i}"]`)))
    const midIdx = Math.floor(adapters.length / 2)
    const splitY = hub.bottom + (a[midIdx].top - hub.bottom) * 0.40

    const branches: Pt[][] = a.map((adapter) => {
      const path: Pt[] = [{ x: hub.cx, y: splitY }]
      if (Math.abs(adapter.cx - hub.cx) > 1) {
        path.push({ x: adapter.cx, y: splitY })
      }
      path.push({ x: adapter.cx, y: adapter.top })
      return path
    })

    P = {
      trunk: [{ x: hub.cx, y: 0 }, { x: hub.cx, y: hub.top }],
      trunk2: [{ x: hub.cx, y: hub.bottom }, { x: hub.cx, y: splitY }],
      branches,
      hubCenter: { x: hub.cx, y: (hub.top + hub.bottom) / 2 },
      hubR: Math.max(hub.bottom - hub.top, 40) * 1.2,
    }
  }

  function len(path: Pt[]): number {
    let l = 0
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x
      const dy = path[i].y - path[i - 1].y
      l += Math.sqrt(dx * dx + dy * dy)
    }
    return l
  }

  function ptAt(path: Pt[], dist: number): Pt {
    let rem = Math.max(0, dist)
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x
      const dy = path[i].y - path[i - 1].y
      const s = Math.sqrt(dx * dx + dy * dy)
      if (rem <= s || i === path.length - 1) {
        const t = s > 0 ? Math.min(rem / s, 1) : 0
        return { x: path[i - 1].x + dx * t, y: path[i - 1].y + dy * t }
      }
      rem -= s
    }
    return path[path.length - 1]
  }

  function drawLine(path: Pt[]) {
    if (path.length < 2) return
    ctx.beginPath()
    ctx.moveTo(path[0].x, path[0].y)
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y)
    ctx.strokeStyle = borderMuted
    ctx.lineWidth = 1
    ctx.lineCap = 'square'
    ctx.lineJoin = 'miter'
    ctx.stroke()
  }

  function drawPulse(path: Pt[], progress: number) {
    const total = len(path)
    const pl = Math.min(50, h * 0.08)
    const head = progress * (total + pl * 0.3)
    const tail = head - pl
    const N = 32

    for (let i = 0; i < N; i++) {
      const t0 = i / N
      const t1 = (i + 1) / N
      const d0 = tail + (head - tail) * t0
      const d1 = tail + (head - tail) * t1
      if (d1 < 0 || d0 > total) continue

      const a = ptAt(path, Math.max(0, d0))
      const b = ptAt(path, Math.min(total, d1))
      const mid = (t0 + t1) / 2
      const alpha = mid * mid * mid

      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = `rgba(${blueR},${blueG},${blueB},${alpha})`
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    const hp = ptAt(path, Math.min(Math.max(0, head), total))
    if (head >= -2 && head <= total + 5) {
      const g = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 8)
      g.addColorStop(0, `rgba(${Math.min(255, blueR + 40)},${Math.min(255, blueG + 47)},${blueB},0.35)`)
      g.addColorStop(1, `rgba(${blueR},${blueG},${blueB},0)`)
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 8, 0, Math.PI * 2)
      ctx.fillStyle = g
      ctx.fill()
    }
  }

  const DUR = 4500

  function frame(ts: number) {
    if (!P) return
    ctx.clearRect(0, 0, w, h)

    // Hub aura
    const g = ctx.createRadialGradient(
      P.hubCenter.x, P.hubCenter.y, 0, P.hubCenter.x, P.hubCenter.y, P.hubR,
    )
    g.addColorStop(0, `rgba(${blueR},${blueG},${blueB},0.06)`)
    g.addColorStop(1, `rgba(${blueR},${blueG},${blueB},0)`)
    ctx.beginPath()
    ctx.arc(P.hubCenter.x, P.hubCenter.y, P.hubR, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()

    // Static lines
    drawLine(P.trunk)
    drawLine(P.trunk2)
    for (const branch of P.branches) drawLine(branch)

    // Pulse animation
    if (!prefersReducedMotion.value) {
      const t = (ts % DUR) / DUR
      if (t < 0.10) drawPulse(P.trunk, t / 0.10)
      if (t >= 0.06 && t < 0.22) drawPulse(P.trunk2, (t - 0.06) / 0.16)
      if (t >= 0.18 && t < 0.58) {
        const ft = (t - 0.18) / 0.40
        for (const branch of P.branches) drawPulse(branch, ft)
      }
    }

    if (!prefersReducedMotion.value) animId = requestAnimationFrame(frame)
  }

  function resize() {
    const rect = ctr.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    w = rect.width
    h = rect.height
    canvas.style.width = `${w }px`
    canvas.style.height = `${h }px`
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    measure()
  }

  resizeObs = new ResizeObserver(() => {
    resize()
    if (prefersReducedMotion.value && P) frame(0)
  })
  resizeObs.observe(ctr)
  resize()

  if (prefersReducedMotion.value) {
    frame(0)
  } else {
    animId = requestAnimationFrame(frame)
  }
}
</script>

<template>
  <section class="py-24 md:py-32" data-section="features-feature-adapters">
    <div class="grid gap-6 lg:grid-cols-2 *:min-w-0">
      <div class="flex flex-col gap-8">
        <Motion
          :initial="false"
          :while-in-view="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.5 }"
          :in-view-options="{ once: true }"
        >
          <div>
            <p v-if="$slots.headline" class="section-label">
              <slot name="headline" mdc-unwrap="p" />
            </p>
            <div class="relative mb-4">
              <h2 class="section-title">
                <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
              </h2>
              <div aria-hidden="true" class="title-glow section-title">
                <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
              </div>
            </div>
            <p v-if="$slots.description" class="max-w-md text-sm leading-relaxed text-muted">
              <slot name="description" mdc-unwrap="p" />
            </p>
            <div class="mt-5 flex flex-wrap gap-2">
              <span
                v-for="pill in pills"
                :key="pill.label"
                class="inline-flex items-center gap-1.5 border border-muted bg-elevated/50 px-3 py-1 font-mono text-[11px] text-muted"
              >
                <UIcon :name="pill.icon" class="size-3 text-primary" />
                {{ pill.label }}
              </span>
            </div>
            <NuxtLink v-if="props.link" :to="props.link" class="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-dimmed hover:text-primary transition-colors">
              {{ props.linkLabel || 'Learn more' }}
              <UIcon name="i-lucide-arrow-right" class="size-3" />
            </NuxtLink>
          </div>
        </Motion>

        <Motion
          :initial="false"
          :while-in-view="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.5, delay: 0.15 }"
          :in-view-options="{ once: true }"
        >
          <div class="space-y-5">
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-zap" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Non-blocking
                </p>
                <p class="mt-1 text-xs leading-relaxed text-dimmed">
                  Pipeline runs in the background. Your response ships immediately.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-shield-check" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Guaranteed delivery
                </p>
                <p class="mt-1 text-xs leading-relaxed text-dimmed">
                  Exponential backoff with jitter ensures logs reach every destination.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-plug" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Bring your own drain
                </p>
                <p class="mt-1 text-xs leading-relaxed text-dimmed">
                  Write a simple function to send logs anywhere.
                </p>
              </div>
            </div>
          </div>
        </Motion>
      </div>

      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.1 }"
        :in-view-options="{ once: true }"
      >
        <div class="overflow-hidden border border-muted bg-default">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">evlog-drain.ts</span>
          </div>

          <div class="px-5 pt-5 pb-4 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto">
            <pre><code><span class="text-violet-400">import</span> { createDrainPipeline } <span class="text-violet-400">from</span> <span class="text-emerald-400">'evlog/pipeline'</span>
<span class="text-violet-400">import</span> { createAxiomDrain } <span class="text-violet-400">from</span> <span class="text-emerald-400">'evlog/axiom'</span>
<span class="text-violet-400">import</span> { createSentryDrain } <span class="text-violet-400">from</span> <span class="text-emerald-400">'evlog/sentry'</span>

<span class="text-violet-400">const</span> pipeline = <span class="text-amber-400">createDrainPipeline</span>({
  <span class="text-sky-400">drains</span>: [
    <span class="text-amber-400">createAxiomDrain</span>(),
    <span class="text-amber-400">createSentryDrain</span>(),
  ],
  <span class="text-sky-400">batchSize</span>: <span class="text-pink-400">50</span>,
  <span class="text-sky-400">flushInterval</span>: <span class="text-pink-400">5000</span>,
})</code></pre>
          </div>

          <div ref="containerRef" class="relative flex flex-col items-center w-full border-t border-muted/50 pt-6 sm:pt-10 pb-5 px-3">
            <canvas ref="canvasRef" class="absolute top-0 left-0 pointer-events-none hidden sm:block" />

            <div data-node="evlog" class="relative z-10 flex flex-col items-center border border-primary/30 bg-default px-6 py-3">
              <div class="flex items-center gap-1.5">
                <span class="relative flex size-1.5">
                  <span class="absolute inline-flex size-full animate-ping bg-primary/40" />
                  <span class="relative inline-flex size-1.5 bg-primary" />
                </span>
                <span class="font-mono text-sm font-medium text-default">evlog</span>
              </div>
              <span class="font-mono text-[7px] tracking-widest text-dimmed mt-1.5">BATCH · RETRY · FANOUT</span>
            </div>

            <div class="h-8 sm:h-16 md:h-20" />

            <div class="relative z-10 self-stretch flex flex-wrap justify-center gap-1.5 sm:grid sm:grid-cols-5 sm:gap-1">
              <div
                v-for="(adapter, idx) in adapters"
                :key="adapter.name"
                class="flex justify-center"
              >
                <div
                  :data-adapter="idx"
                  class="flex items-center gap-1.5 border border-muted bg-default px-2.5 py-1.5"
                >
                  <UIcon :name="adapter.icon" class="size-3 shrink-0 text-dimmed" />
                  <span class="font-mono text-[9px] text-muted whitespace-nowrap">{{ adapter.name }}</span>
                </div>
              </div>
            </div>

            <div class="relative z-10 mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <span class="font-mono text-[9px] text-dimmed">+ File System</span>
              <span class="font-mono text-[9px] text-dimmed">·</span>
              <span class="font-mono text-[9px] text-dimmed">Custom drains</span>
              <span class="font-mono text-[9px] text-dimmed">·</span>
              <span class="font-mono text-[9px] text-muted">and more</span>
            </div>
          </div>
        </div>
      </Motion>
    </div>
  </section>
</template>
