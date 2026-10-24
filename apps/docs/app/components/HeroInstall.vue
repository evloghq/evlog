<script setup lang="ts">
import { useClipboard, useMediaQuery } from '@vueuse/core'
import { AnimatePresence, Motion } from 'motion-v'

type Audience = 'humans' | 'agents'

const PM_COMMANDS = {
  pnpm: 'pnpm add',
  npm: 'npm install',
  yarn: 'yarn add',
  bun: 'bun add',
} as const

type PmKey = keyof typeof PM_COMMANDS

const PM_KEYS = Object.keys(PM_COMMANDS) as PmKey[]

const AGENTS_COMMAND = 'npx skills add https://www.evlog.dev'

const audiences: { key: Audience, label: string }[] = [
  { key: 'humans', label: 'For humans' },
  { key: 'agents', label: 'For agents' },
]

const audience = ref<Audience>('agents')

const pmCookie = useCookie<PmKey>('evlog-pm', { default: () => 'pnpm', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
const pmKey = computed<PmKey>(() => PM_KEYS.includes(pmCookie.value) ? pmCookie.value : 'pnpm')
const pmRun = computed(() => PM_COMMANDS[pmKey.value])
const command = computed(() => audience.value === 'agents' ? AGENTS_COMMAND : `${pmRun.value} evlog`)

function cyclePm() {
  pmCookie.value = PM_KEYS[(PM_KEYS.indexOf(pmKey.value) + 1) % PM_KEYS.length]!
}

const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
const EASE = [0.23, 1, 0.32, 1] as const

const swapInitial = computed(() => reduced.value
  ? { opacity: 0 }
  : { opacity: 0, filter: 'blur(4px)' })
const swapEnter = computed(() => reduced.value
  ? { opacity: 1, transition: { duration: 0.12 } }
  : { opacity: 1, filter: 'blur(0px)', transition: { duration: 0.18, ease: EASE } })
const swapExit = computed(() => reduced.value
  ? { opacity: 0, transition: { duration: 0.1 } }
  : { opacity: 0, filter: 'blur(3px)', transition: { duration: 0.12, ease: 'easeOut' } })

const appConfig = useAppConfig()
const { copy, copied } = useClipboard()

function copyCommand() {
  copy(command.value)
  trackEvent('install_command_copied', { source: 'hero', audience: audience.value, command: command.value })
}
</script>

<template>
  <div class="flex flex-col items-center">
    <div class="mb-2 flex items-center gap-3 font-pixel text-[10px] uppercase tracking-widest">
      <template v-for="(a, i) in audiences" :key="a.key">
        <span v-if="i > 0" class="w-px h-3 bg-accented" aria-hidden="true" />
        <button
          type="button"
          :aria-pressed="audience === a.key"
          class="transition-colors duration-150 cursor-pointer"
          :class="audience === a.key ? 'text-highlighted' : 'text-dimmed hover:text-muted'"
          @click="audience = a.key"
        >
          {{ a.label }}
        </button>
      </template>
    </div>

    <button
      type="button"
      class="group flex items-center gap-2 px-4 py-1.5 rounded-full border border-muted backdrop-blur-sm cursor-copy transition-[border-color,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-primary/50 active:scale-[0.98]"
      :aria-label="copied ? 'Command copied' : `Copy ${command}`"
      @click="copyCommand"
    >
      <span class="font-mono text-xs text-primary select-none" aria-hidden="true">$</span>

      <span
        class="relative inline-block h-4 overflow-hidden font-mono text-xs text-highlighted transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
        :style="{ width: audience === 'humans' ? `calc(${command.length}ch + 16px)` : `${command.length}ch` }"
      >
        <AnimatePresence :initial="false">
          <Motion
            :key="command"
            as="span"
            class="absolute inset-0 whitespace-pre text-left"
            :initial="swapInitial"
            :animate="swapEnter"
            :exit="swapExit"
          >
            <template v-if="audience === 'humans'">
              <button
                type="button"
                title="Switch package manager"
                :aria-label="`Switch package manager (current: ${pmKey})`"
                class="group/pm inline-flex items-center gap-1 cursor-pointer transition-colors hover:text-primary"
                @click.stop="cyclePm"
              >
                <span class="underline decoration-dotted decoration-[var(--ui-text-dimmed)] underline-offset-2 transition-colors group-hover/pm:decoration-[var(--ui-primary)]">{{ pmRun }}</span>
                <UIcon name="i-lucide-chevrons-up-down" class="size-3 text-dimmed transition-colors group-hover/pm:text-primary" />
              </button><span> evlog</span>
            </template>
            <template v-else>{{ AGENTS_COMMAND }}</template>
          </Motion>
        </AnimatePresence>
      </span>

      <span class="relative size-3.5 shrink-0" aria-hidden="true">
        <UIcon
          :name="appConfig.ui.icons.copy"
          class="absolute inset-0 size-3.5 text-dimmed transition-[opacity,transform] duration-150 group-hover:text-highlighted"
          :class="copied ? 'opacity-0 scale-75' : 'opacity-100'"
        />
        <UIcon
          :name="appConfig.ui.icons.copyCheck"
          class="absolute inset-0 size-3.5 text-emerald-400 transition-[opacity,transform] duration-150"
          :class="copied ? 'opacity-100' : 'opacity-0 scale-75'"
        />
      </span>
    </button>
  </div>
</template>
