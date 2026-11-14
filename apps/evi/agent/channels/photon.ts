import { connectPhotonCredentials } from '@vercel/connect/eve'
import { photonIMessageChannel } from 'eve/channels/photon'
import { interaction } from 'eve/events'
import { failureLine, flattenInline } from '../lib/failure'
import { MAINTAINER_PHONE } from '../lib/trust'

export default photonIMessageChannel({
  credentials: connectPhotonCredentials('photon/evi'),
  // The Photon project's user allowlist only registers Hugo, so every inbound
  // message is his. Revisit when more users are added there.
  onMessage(_ctx, message) {
    if (message.author.isBot || MAINTAINER_PHONE === undefined) return null
    return {
      auth: {
        attributes: {},
        authenticator: 'photon-imessage',
        principalId: `imessage:${MAINTAINER_PHONE}`,
        principalType: 'user',
      },
    }
  },
  events: {
    // Replaces eve's prompt card with plain text: iMessage shows no buttons,
    // so each option says what to reply. Sign-ins keep eve's own handling.
    async committed(line, ctx) {
      const { thread } = ctx.channel
      if (!thread) return

      const opened = line.facts.flatMap((fact) => {
        if (fact.type !== 'interaction.opened') return []
        const request = interaction(ctx.view, fact.data.interactionId)
        return request && request.request.kind !== 'sign-in' ? [request] : []
      })
      if (opened.length === 0) return

      const body = opened
        .map(({ request, call }) => {
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
        })
        .join('\n\n')

      await thread.post(body)
    },
    // A terminal failure is always reported in the thread; a failed turn never ends silent.
    async 'turn.settled'(event, ctx) {
      if (event.data.outcome !== 'failed' || !ctx.channel.thread) return
      await ctx.channel.thread.post(failureLine('That turn failed', 'Send the message again to retry.', event.data.error ?? {}))
    },
    async 'session.ended'(event, ctx) {
      if (event.data.outcome !== 'failed' || !ctx.channel.thread) return
      await ctx.channel.thread.post(failureLine('This session could not recover', 'Send a new message to start over.', event.data.error ?? {}))
    },
  },
})
