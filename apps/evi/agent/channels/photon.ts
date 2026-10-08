import { connectPhotonCredentials } from '@vercel/connect/eve'
import { photonIMessageChannel } from 'eve/channels/photon'
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
    async 'input.requested'(event, channel) {
      if (!channel.thread || event.requests.length === 0) return

      const body = event.requests
        .map((request) => {
          const lines = [request.prompt]

          if (request.kind === 'tool-approval') {
            for (const [key, value] of Object.entries(request.action.input)) {
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

      await channel.thread.post(body)
    },
    // eve 0.73 spans the built-in prompt queue across `input.requested`,
    // `input.resolved` and `approval.settled` on Chat SDK channels. Photon
    // renders prompts itself from `input.requested`, so the other two are
    // explicit no-ops; otherwise the built-in handlers post prompts twice
    // and stop posting later ones.
    async 'input.resolved'() {},
    async 'approval.settled'() {},
    // A terminal failure is always reported in the thread; a failed turn never ends silent.
    async 'turn.failed'(event, channel) {
      if (!channel.thread) return
      await channel.thread.post(failureLine('That turn failed', 'Send the message again to retry.', event))
    },
    async 'session.failed'(event, channel) {
      if (!channel.thread) return
      await channel.thread.post(failureLine('This session could not recover', 'Send a new message to start over.', event))
    },
  },
})
