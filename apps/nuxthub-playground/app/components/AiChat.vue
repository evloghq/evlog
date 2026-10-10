<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { MDC } from 'mdc-syntax/vue'

const chat = new Chat({})
const chatInput = ref('')
const chatContainer = ref<HTMLElement | null>(null)
const quickQuestions = [
  'Any recent errors?',
  'How many logs by level?',
  'What are the slowest requests?',
  'Summarize the last 10 logs',
]

function scrollChatToBottom() {
  nextTick(() => {
    if (chatContainer.value)
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  })
}

watch(() => chat.messages.length, scrollChatToBottom)
watch(() => chat.messages.at(-1)?.parts.length, scrollChatToBottom)

function sendChat() {
  const text = chatInput.value.trim()
  if (!text || chat.status === 'streaming' || chat.status === 'submitted') return
  chat.sendMessage({ text })
  chatInput.value = ''
  scrollChatToBottom()
}

function askQuick(question: string) {
  chatInput.value = question
  sendChat()
}

const isLoading = computed(() => chat.status === 'streaming' || chat.status === 'submitted')

interface ToolPart {
  type: string
  state?: string
  errorText?: string
  input?: { query?: string }
  output?: { count?: number, error?: string }
}

interface AiMessageMetadata {
  calls?: number
  totalTokens?: number
  estimatedCost?: number
  finishReason?: string
}

interface ChatMessage {
  metadata?: AiMessageMetadata
}

function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

function getToolInput(part: ToolPart): { query?: string } {
  return part.input ?? {}
}

function getToolOutput(part: ToolPart): { count?: number, error?: string } | undefined {
  return part.output
}

function getAiMetadata(message: ChatMessage): AiMessageMetadata | undefined {
  const meta = message.metadata
  if (!meta || (meta.calls === undefined && meta.totalTokens === undefined)) return undefined
  return meta
}

function setQuickButtonHover(event: MouseEvent, active: boolean) {
  const el = event.currentTarget
  if (!(el instanceof HTMLElement)) return
  el.style.borderColor = active ? '#3182ce' : '#e2e8f0'
  el.style.background = active ? '#ebf8ff' : '#fff'
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined) return '—'
  if (cost === 0) return '$0'
  return `$${cost.toFixed(6)}`
}
</script>

<template>
  <div style="position: sticky; top: 1.5rem; display: flex; flex-direction: column; height: calc(100vh - 6rem);">
    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
      <h2 style="margin: 0;">
        Ask AI
      </h2>
      <span
        v-if="isLoading"
        style="font-size: 0.78rem; padding: 0.15rem 0.5rem; border-radius: 10px; display: inline-flex; align-items: center; gap: 0.35rem; background: #c6f6d5; color: #276749;"
      >
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #38a169; animation: pulse 1s infinite;" />
        {{ chat.status === 'submitted' ? 'Thinking...' : 'Streaming...' }}
      </span>
    </div>

    <div
      ref="chatContainer"
      style="flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; overflow-y: auto; padding: 0.75rem; background: #f8fafc; display: flex; flex-direction: column; gap: 0.5rem; min-height: 0;"
    >
      <div v-if="chat.messages.length === 0" style="color: #a0aec0; font-size: 0.85rem; margin: auto; text-align: center;">
        Ask questions about your logs, e.g. "Any recent errors?" or "How many logs by level?"
      </div>

      <template v-for="(message, index) in chat.messages" :key="message.id">
        <div
          v-if="message.role === 'assistant' && getAiMetadata(message)"
          style="flex-shrink: 0; align-self: flex-start; max-width: 85%; padding: 0.3rem 0.55rem; border-radius: 6px; font-size: 0.7rem; color: #4a5568; background: #edf2f7; border: 1px solid #e2e8f0; font-family: monospace; display: inline-flex; gap: 0.5rem; flex-wrap: wrap;"
        >
          <span>step {{ getAiMetadata(message)?.calls }}</span>
          <span>·</span>
          <span>{{ getAiMetadata(message)?.totalTokens }} tokens</span>
          <span>·</span>
          <span>{{ formatCost(getAiMetadata(message)?.estimatedCost) }}</span>
          <span v-if="getAiMetadata(message)?.finishReason">·</span>
          <span v-if="getAiMetadata(message)?.finishReason">{{ getAiMetadata(message)?.finishReason }}</span>
        </div>
        <template v-for="(part, pi) in message.parts" :key="`${message.id}-${part.type}-${pi}`">
          <div
            v-if="message.role === 'user' && part.type === 'text'"
            style="flex-shrink: 0; align-self: flex-end; max-width: 85%; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.85rem; white-space: pre-wrap; word-break: break-word; line-height: 1.5; background: #3182ce; color: #fff;"
          >
            {{ part.text }}
          </div>

          <div
            v-else-if="message.role === 'assistant' && part.type === 'text'"
            class="chat-md"
            style="flex-shrink: 0; align-self: flex-start; max-width: 85%; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.85rem; word-break: break-word; line-height: 1.5; background: #fff; color: #2d3748; border: 1px solid #e2e8f0;"
          >
            <MDC :markdown="part.text" />
          </div>

          <div
            v-else-if="isToolPart(part)"
            style="flex-shrink: 0; align-self: flex-start; max-width: 90%; border-radius: 8px; font-size: 0.8rem; overflow: hidden; border: 1px solid #e2e8f0; background: #fff;"
          >
            <div style="padding: 0.4rem 0.65rem; background: #1a202c; color: #e2e8f0; font-family: monospace; font-size: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
              <span style="color: #90cdf4;">SQL</span>
              <span style="color: #a0aec0;">queryEvents</span>
            </div>
            <div style="padding: 0.5rem 0.65rem; font-family: monospace; font-size: 0.75rem; color: #2d3748; white-space: pre-wrap; word-break: break-all; background: #f7fafc; border-bottom: 1px solid #e2e8f0;">
              {{ getToolInput(part).query || JSON.stringify(getToolInput(part)) }}
            </div>
            <div style="padding: 0.3rem 0.65rem; font-size: 0.75rem;">
              <span v-if="part.state === 'output-error'" style="color: #e53e3e;">Error: {{ part.errorText }}</span>
              <span v-else-if="getToolOutput(part)?.error" style="color: #e53e3e;">Error: {{ getToolOutput(part)?.error }}</span>
              <span v-else-if="part.state === 'output-available'" style="color: #38a169;">{{ getToolOutput(part)?.count ?? 0 }} row{{ (getToolOutput(part)?.count ?? 0) !== 1 ? 's' : '' }} returned</span>
              <span v-else style="color: #a0aec0; display: inline-flex; align-items: center; gap: 0.3rem;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #d69e2e; animation: pulse 1s infinite;" />
                Querying...
              </span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <div v-if="chat.messages.length === 0" style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.5rem;">
      <button
        v-for="q in quickQuestions"
        :key="q"
        style="padding: 0.3rem 0.6rem; font-size: 0.78rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 999px; color: #4a5568; cursor: pointer; transition: border-color 0.15s, background 0.15s;"
        @mouseenter="setQuickButtonHover($event, true)"
        @mouseleave="setQuickButtonHover($event, false)"
        @click="askQuick(q)"
      >
        {{ q }}
      </button>
    </div>

    <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
      <input
        v-model="chatInput"
        placeholder="Ask about your logs..."
        style="flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;"
        @keydown.enter="sendChat"
      >
      <button
        :disabled="isLoading || !chatInput.trim()"
        style="padding: 0.5rem 1rem; font-size: 0.85rem;"
        :style="{ opacity: isLoading || !chatInput.trim() ? 0.5 : 1 }"
        @click="sendChat"
      >
        Send
      </button>
    </div>
  </div>
</template>

<style>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.chat-md p { margin: 0.3em 0; }
.chat-md p:first-child { margin-top: 0; }
.chat-md p:last-child { margin-bottom: 0; }
.chat-md ul, .chat-md ol { margin: 0.3em 0; padding-left: 1.4em; }
.chat-md li { margin: 0.15em 0; }
.chat-md code {
  font-size: 0.8em;
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
}
.chat-md pre {
  background: #1a202c;
  color: #e2e8f0;
  padding: 0.6em 0.75em;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.8em;
  margin: 0.4em 0;
}
.chat-md pre code {
  background: none;
  padding: 0;
  color: inherit;
}
.chat-md h1, .chat-md h2, .chat-md h3 {
  margin: 0.5em 0 0.25em;
  font-size: 1em;
  font-weight: 600;
}
.chat-md strong { font-weight: 600; }
.chat-md a { color: #3182ce; text-decoration: underline; }
.chat-md table { border-collapse: collapse; margin: 0.4em 0; font-size: 0.85em; width: 100%; }
.chat-md th, .chat-md td { border: 1px solid #e2e8f0; padding: 0.3em 0.5em; text-align: left; }
.chat-md th { background: #f7fafc; font-weight: 600; }
.chat-md blockquote {
  border-left: 3px solid #e2e8f0;
  margin: 0.4em 0;
  padding: 0.2em 0.6em;
  color: #718096;
}
.chat-md hr { border: none; border-top: 1px solid #e2e8f0; margin: 0.5em 0; }
</style>
