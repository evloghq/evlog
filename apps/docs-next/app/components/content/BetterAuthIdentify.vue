<script setup lang="ts">
interface Step {
  label: string
  code: string
  result: string
}

const steps: Step[] = [
  { label: 'Route check', code: `exclude: ['/api/auth/**']`, result: '/api/checkout is not excluded' },
  { label: 'Session', code: 'auth.api.getSession({ headers })', result: 'Found in 12ms' },
  { label: 'Identify', code: 'identifyUser(log, session)', result: 'Fields set on the event' },
]

interface Line {
  depth: number
  key?: string
  /** A quoted string, a number or a boolean. */
  value?: string
  open?: boolean
  close?: boolean
  comma?: boolean
  /** Set by better-auth, as opposed to the request itself. */
  added?: boolean
}

const lines: Line[] = [
  { depth: 0, open: true },
  { depth: 1, key: 'method', value: '"POST"', comma: true },
  { depth: 1, key: 'path', value: '"/api/checkout"', comma: true },
  { depth: 1, key: 'status', value: '200', comma: true },
  { depth: 1, key: 'userId', value: '"QBX9tPjJQExWawAbNll75"', comma: true, added: true },
  { depth: 1, key: 'user', open: true, added: true },
  { depth: 2, key: 'id', value: '"QBX9tPjJQExWawAbNll75"', comma: true, added: true },
  { depth: 2, key: 'name', value: '"Hugo Richard"', comma: true, added: true },
  { depth: 2, key: 'email', value: '"hugo@example.com"', added: true },
  { depth: 1, close: true, comma: true, added: true },
  { depth: 1, key: 'session', open: true, added: true },
  { depth: 2, key: 'id', value: '"Xhmh6TxKJQrVKFX0Y0II"', comma: true, added: true },
  { depth: 2, key: 'expiresAt', value: '"2024-01-22T10:00:00.000Z"', added: true },
  { depth: 1, close: true, comma: true, added: true },
  { depth: 1, key: 'auth', open: true, added: true },
  { depth: 2, key: 'resolvedIn', value: '12', comma: true, added: true },
  { depth: 2, key: 'identified', value: 'true', added: true },
  { depth: 1, close: true, added: true },
  { depth: 0, close: true },
]

const added = lines.filter(line => line.added)

const reached = ref(0)
const resolved = ref(0)
const fields = ref(0)

const STEP = 700
const FIELDS_AT = 200 + steps.length * STEP
const FIELD = 110

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [
    ...steps.flatMap((_, i) => [
      { at: 200 + i * STEP, run: () => {
        reached.value = i + 1
      } },
      { at: 200 + i * STEP + 380, run: () => {
        resolved.value = i + 1
      } },
    ]),
    ...added.map((_, i) => ({ at: FIELDS_AT + i * FIELD, run: () => {
      fields.value = i + 1
    } })),
  ],
  reset: () => {
    reached.value = 0
    resolved.value = 0
    fields.value = 0
  },
  settle: () => {
    reached.value = steps.length
    resolved.value = steps.length
    fields.value = added.length
  },
})

function lineShown(line: Line) {
  return !line.added || fields.value > added.indexOf(line)
}

function valueClass(value: string) {
  if (value.startsWith('"')) return 'text-(--d-out-ok)'
  return 'text-(--d-out-key)'
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="One request through the middleware. It skips the auth routes, reads the session from the request headers, and identifyUser() adds the user and the session to the wide event."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div class="border-b border-(--d-line) p-5 md:border-r md:border-b-0">
        <p class="mb-4 text-[13px] text-dimmed">
          The middleware
        </p>
        <ol class="flex flex-col gap-4">
          <li v-for="(step, i) in steps" :key="step.label" class="flex min-w-0 gap-3">
            <span
              class="mt-[7px] size-[5px] shrink-0 rounded-full transition-colors duration-300"
              :class="reached > i ? 'bg-(--d-signal)' : 'bg-(--d-line-strong)'"
            />
            <div class="min-w-0">
              <p class="text-[13px]/5 transition-colors duration-300" :class="reached > i ? 'text-highlighted' : 'text-dimmed'">
                {{ step.label }}
              </p>
              <p class="truncate font-mono text-[12px]/5 text-muted">
                {{ step.code }}
              </p>
              <p class="d-step truncate text-[13px]/5 text-dimmed" :data-on="resolved > i">
                {{ step.result }}
              </p>
            </div>
          </li>
        </ol>
      </div>

      <div class="min-w-0 p-5">
        <p class="mb-4 text-[13px] text-dimmed">
          The wide event
        </p>
        <pre class="overflow-x-auto overflow-y-hidden font-mono text-[12px]/5" aria-label="The wide event after identifyUser()"><span
          v-for="(line, i) in lines"
          :key="i"
          class="d-step block whitespace-pre"
          :data-on="lineShown(line)"
        ><span class="text-default">{{ '  '.repeat(line.depth) }}</span><template v-if="line.key"><span class="text-[#f90]">"{{ line.key }}"</span><span class="text-default">: </span></template><span v-if="line.value" :class="valueClass(line.value)">{{ line.value }}</span><span v-if="line.open" class="text-default">{</span><span v-if="line.close" class="text-default">}</span><span v-if="line.comma" class="text-default">,</span></span></pre>
      </div>
    </div>
  </DocsFigure>
</template>
