<script setup lang="ts">
const levelFilter = ref('')
const logs = ref<any[] | null>(null)
const totalCount = ref<number | null>(null)
const expandedId = ref<string | null>(null)
const autoRefresh = ref(false)
let autoRefreshInterval: ReturnType<typeof setInterval> | null = null

function levelColor(level: string) {
  switch (level) {
    case 'error': return '#e53e3e'
    case 'warn': return '#d69e2e'
    case 'info': return '#3182ce'
    case 'debug': return '#718096'
    default: return '#333'
  }
}

function statusColor(status: number | null) {
  if (!status) return '#718096'
  if (status >= 500) return '#e53e3e'
  if (status >= 400) return '#d69e2e'
  if (status >= 200 && status < 300) return '#38a169'
  return '#718096'
}

function parseJson(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value) 
  } catch {
    return null 
  }
}

function flattenData(obj: Record<string, any>, depth = 0): Array<{ key: string, value: string | null, depth: number }> {
  const rows: Array<{ key: string, value: string | null, depth: number }> = []
  for (const [key, val] of Object.entries(obj)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      rows.push({ key, value: null, depth })
      rows.push(...flattenData(val, depth + 1))
    } else if (Array.isArray(val)) {
      rows.push({ key, value: val.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', '), depth })
    } else {
      rows.push({ key, value: val === null ? 'null' : String(val), depth })
    }
  }
  return rows
}

function toggle(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

async function fetchLogs() {
  const query = levelFilter.value ? `?level=${levelFilter.value}` : ''
  const res = await $fetch<{ total: number, events: any[] }>(`/api/logs${query}`)
  logs.value = res.events
  totalCount.value = res.total
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    fetchLogs()
    autoRefreshInterval = setInterval(fetchLogs, 2000)
  } else if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
    autoRefreshInterval = null
  }
}

onUnmounted(() => {
  if (autoRefreshInterval)
    clearInterval(autoRefreshInterval)
})
</script>

<template>
  <section>
    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
      <h2 style="margin: 0;">
        Stored Logs
      </h2>
      <span v-if="totalCount !== null" style="font-size: 0.8rem; color: #718096; background: #edf2f7; padding: 0.15rem 0.5rem; border-radius: 10px;">
        {{ totalCount }} in DB
      </span>
      <select v-model="levelFilter" style="font-size: 0.85rem; padding: 0.2rem 0.4rem;" @change="fetchLogs">
        <option value="">
          All levels
        </option>
        <option value="info">
          info
        </option>
        <option value="error">
          error
        </option>
        <option value="warn">
          warn
        </option>
        <option value="debug">
          debug
        </option>
      </select>
      <button style="font-size: 0.8rem;" @click="fetchLogs">
        Refresh
      </button>
      <button
        style="font-size: 0.8rem;"
        :style="{ background: autoRefresh ? '#38a169' : '', color: autoRefresh ? '#fff' : '' }"
        @click="toggleAutoRefresh"
      >
        {{ autoRefresh ? 'Auto ●' : 'Auto ○' }}
      </button>
    </div>

    <p v-if="logs === null" style="color: #999;">
      Click Refresh to load logs
    </p>

    <div v-else-if="logs.length === 0" style="color: #999;">
      No logs found
    </div>

    <div v-else style="display: flex; flex-direction: column; gap: 2px;">
      <div
        v-for="log in logs"
        :key="log.id"
        style="border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;"
      >
        <div
          style="display: grid; grid-template-columns: 90px 50px 40px 1fr 40px 55px 20px; align-items: center; gap: 0.4rem; padding: 0.4rem 0.6rem; font-size: 0.78rem; cursor: pointer; transition: background 0.1s;"
          :style="{ background: expandedId === log.id ? '#f8fafc' : '#fff' }"
          @click="toggle(log.id)"
        >
          <span style="color: #718096; font-variant-numeric: tabular-nums;">
            {{ new Date(log.timestamp).toLocaleTimeString() }}
          </span>
          <span
            style="font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em;"
            :style="{ color: levelColor(log.level) }"
          >
            {{ log.level }}
          </span>
          <span style="color: #4a5568; font-weight: 500;">
            {{ log.method || '-' }}
          </span>
          <span style="color: #2d3748; font-family: monospace; font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ log.path || '-' }}
          </span>
          <span
            style="font-weight: 600; font-variant-numeric: tabular-nums;"
            :style="{ color: statusColor(log.status) }"
          >
            {{ log.status || '-' }}
          </span>
          <span style="color: #718096; font-variant-numeric: tabular-nums; text-align: right;">
            {{ log.durationMs ? `${log.durationMs}ms` : '-' }}
          </span>
          <span style="color: #a0aec0; font-size: 0.7rem; text-align: center; transition: transform 0.15s;" :style="{ transform: expandedId === log.id ? 'rotate(90deg)' : '' }">
            &#9654;
          </span>
        </div>

        <div v-if="expandedId === log.id" style="border-top: 1px solid #e2e8f0; padding: 0.75rem; background: #f8fafc; font-size: 0.82rem;">
          <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem; color: #718096; font-size: 0.78rem;">
            <span v-if="log.service"><strong>service:</strong> {{ log.service }}</span>
            <span v-if="log.requestId"><strong>requestId:</strong> <code style="font-size: 0.75rem; background: #edf2f7; padding: 0.1rem 0.3rem; border-radius: 3px;">{{ log.requestId }}</code></span>
            <span v-if="log.source"><strong>source:</strong> {{ log.source }}</span>
            <span v-if="log.environment"><strong>env:</strong> {{ log.environment }}</span>
          </div>

          <div
            v-if="parseJson(log.error)"
            style="background: #fff5f5; border: 1px solid #fed7d7; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem;"
          >
            <div style="font-weight: 600; color: #c53030; margin-bottom: 0.5rem; font-size: 0.85rem;">
              {{ parseJson(log.error).name || 'Error' }}: {{ parseJson(log.error).message }}
            </div>
            <div v-if="parseJson(log.error).data?.why" style="margin-bottom: 0.4rem;">
              <span style="color: #c05621; font-weight: 600;">Why: </span>
              <span style="color: #4a5568;">{{ parseJson(log.error).data.why }}</span>
            </div>
            <div v-if="parseJson(log.error).data?.fix" style="margin-bottom: 0.4rem;">
              <span style="color: #2b6cb0; font-weight: 600;">Fix: </span>
              <span style="color: #4a5568;">{{ parseJson(log.error).data.fix }}</span>
            </div>
            <a
              v-if="parseJson(log.error).data?.link"
              :href="parseJson(log.error).data.link"
              target="_blank"
              style="color: #3182ce; font-size: 0.8rem; text-decoration: underline;"
            >
              {{ parseJson(log.error).data.link }}
            </a>
            <div v-if="parseJson(log.error).statusCode" style="margin-top: 0.4rem; color: #718096; font-size: 0.78rem;">
              Status: {{ parseJson(log.error).statusCode }}
            </div>
          </div>

          <div v-if="parseJson(log.data)" style="background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem;">
            <div style="font-weight: 600; color: #4a5568; margin-bottom: 0.5rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em;">
              Data
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;">
              <template v-for="(row, i) in flattenData(parseJson(log.data))" :key="i">
                <span style="color: #718096; font-weight: 500;" :style="{ paddingLeft: row.depth * 12 + 'px' }">{{ row.key }}</span>
                <span v-if="row.value !== null" style="color: #2d3748; font-family: monospace; font-size: 0.8rem; word-break: break-all;">
                  {{ row.value }}
                </span>
                <span v-else />
              </template>
            </div>
          </div>

          <div v-if="!parseJson(log.error) && !parseJson(log.data)" style="color: #a0aec0; font-style: italic;">
            No additional data
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
