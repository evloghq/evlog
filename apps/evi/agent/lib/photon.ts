import { type Interaction, nextPrompt, type SessionView } from 'eve/events'
import { flattenInline } from './failure'

/**
 * iMessage shows no buttons, so a prompt is plain text: an approval lists the
 * call's non-empty inputs, and each option says what to reply.
 */
export function promptText({ request, call }: Interaction): string {
  const lines = [request.prompt]

  const input = call?.input
  if (request.kind === 'approval' && input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input)) {
      if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue
      lines.push(`${key}: ${flattenInline(value)}`)
    }
  }

  const options = request.options ?? []
  if (options.length > 0) {
    lines.push('', ...options.map((option) => `· ${option.label}: reply "${option.id}"`))
    lines.push('Or answer in your own words.')
  }

  return lines.join('\n')
}

/** Channel state recording the request on screen. */
export interface PromptState {
  [key: string]: unknown
  promptOnScreen?: string
}

/**
 * Posts the request a typed reply answers now, once. A text-only thread shows
 * that request alone, or a reply would answer one the person never saw.
 * Sign-ins are never `nextPrompt`; eve posts those itself.
 */
export async function showNextPrompt(view: SessionView, state: PromptState, post: (text: string) => Promise<unknown>): Promise<void> {
  const prompt = nextPrompt(view)
  if (prompt === undefined) {
    delete state.promptOnScreen
    return
  }
  if (prompt.interactionId === state.promptOnScreen) return
  await post(promptText(prompt))
  state.promptOnScreen = prompt.interactionId
}
