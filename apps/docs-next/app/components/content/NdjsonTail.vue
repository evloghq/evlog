<script setup lang="ts">
interface Line {
  file: 0 | 1
  level: 'info' | 'warn' | 'error'
  path: string
  status: number
  /** Already in the file when the tail starts. */
  existing?: boolean
}

const files = ['2026-05-08.jsonl', '2026-05-09.jsonl']

const lines: Line[] = [
  { file: 0, level: 'info', path: '/api/login', status: 200, existing: true },
  { file: 0, level: 'error', path: '/api/checkout', status: 500, existing: true },
  { file: 0, level: 'info', path: '/api/me', status: 200 },
  { file: 0, level: 'info', path: '/api/email', status: 200 },
  { file: 1, level: 'warn', path: '/api/cart', status: 401 },
  { file: 1, level: 'info', path: '/api/checkout', status: 200 },
]

const existing = lines.filter(line => line.existing).length

const written = ref(existing)
const yielded = ref(0)
const APPEND = 650
const READ = 260

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [
    ...lines.slice(0, existing).map((_, i) => ({ at: 300 + i * 200, run: () => {
      yielded.value = i + 1
    } })),
    ...lines.slice(existing).flatMap((_, j) => {
      const i = existing + j
      const at = 1000 + j * APPEND
      return [
        { at, run: () => {
          written.value = i + 1
        } },
        { at: at + READ, run: () => {
          yielded.value = i + 1
        } },
      ]
    }),
  ],
  reset: () => {
    written.value = existing
    yielded.value = 0
  },
  settle: () => {
    written.value = lines.length
    yielded.value = lines.length
  },
})

function fileLines(file: 0 | 1) {
  return lines.map((line, i) => ({ line, i })).filter(entry => entry.line.file === file)
}

const rotated = computed(() => lines.slice(0, written.value).some(line => line.file === 1))

const LEVEL = {
  info: 'text-(--d-out-key)',
  warn: 'text-(--d-out-warn)',
  error: 'text-(--d-out-error)',
}

function source(line: Line) {
  if (line.existing) return 'History'
  return line.file === 1 ? 'New file' : 'Appended'
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="tailFsLogs() yields the events already on disk, then each line as it is appended, and picks up the next day's file when it appears."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div class="border-b border-(--d-line) p-5 md:border-r md:border-b-0">
        <p class="mb-3 text-[13px] text-dimmed">
          .evlog/logs
        </p>

        <div v-for="(file, f) in files" :key="file" :class="f ? 'mt-3' : ''">
          <p
            class="d-step flex h-6 items-center font-mono text-[12px] text-muted"
            :data-on="f === 0 || rotated"
          >
            {{ file }}
          </p>
          <ol class="font-mono text-[12px]">
            <li
              v-for="{ line, i } in fileLines(f as 0 | 1)"
              :key="i"
              class="d-step flex h-6 items-center"
              :data-on="written > i"
            >
              <span class="truncate text-default">
                <span class="text-dimmed">{</span><span class="text-muted">"level":</span>"{{ line.level }}"<span class="text-dimmed">,</span><span class="text-muted">"status":</span>{{ line.status }}<span class="text-dimmed">,</span><span class="text-muted">"path":</span>"{{ line.path }}"<span class="text-dimmed">}</span>
              </span>
            </li>
          </ol>
        </div>
      </div>

      <div class="p-5">
        <p class="mb-3 text-[13px] text-dimmed">
          Yielded by tailFsLogs()
        </p>

        <ol class="font-mono text-[12px]">
          <li
            v-for="(line, i) in lines"
            :key="i"
            class="d-step grid h-6 grid-cols-[minmax(0,1fr)_4rem] items-center gap-3"
            :data-on="yielded > i"
          >
            <span class="flex min-w-0 gap-2">
              <span class="w-10 shrink-0 uppercase" :class="LEVEL[line.level]">{{ line.level }}</span>
              <span class="w-7 shrink-0 tabular-nums" :class="line.status >= 500 ? 'text-(--d-out-error)' : line.status >= 400 ? 'text-(--d-out-warn)' : 'text-(--d-out-ok)'">{{ line.status }}</span>
              <span class="truncate text-default">{{ line.path }}</span>
            </span>
            <span class="text-right font-sans text-[12.5px] text-dimmed">{{ source(line) }}</span>
          </li>
        </ol>
      </div>
    </div>
  </DocsFigure>
</template>
