import { connectPhotonCredentials } from '@vercel/connect/eve'
import { photonIMessageChannel } from 'eve/channels/photon'
import { failureLine } from '../lib/failure'
import { showNextPrompt } from '../lib/photon'
import { MAINTAINER_PHONE } from '../lib/trust'

export default photonIMessageChannel({
  credentials: connectPhotonCredentials('photon/evi'),
  // The Photon project's user allowlist only registers the maintainer, so every
  // inbound message is theirs. Revisit when more users are added there.
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
    // Replaces eve's prompt card with plain text that also lists an approval's inputs.
    async committed(_line, ctx) {
      const { thread, state } = ctx.channel
      if (thread) await showNextPrompt(ctx.view, state, (text) => thread.post(text))
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
