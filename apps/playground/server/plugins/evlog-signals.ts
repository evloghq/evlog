import { createSignals } from '@evlog/signals'
import { mock } from '../signals/mock'
import { signals } from '../signals'

// Runs the model when AI_GATEWAY_API_KEY is set, scripted answers otherwise.
export default defineNitroPlugin((nitroApp) => {
  const plugin = createSignals({
    signals,
    budget: { perMinute: 300 },
    evaluate: process.env.AI_GATEWAY_API_KEY ? undefined : mock.evaluate,
    providerOptions: { gateway: { zeroDataRetention: true } },
  })

  nitroApp.hooks.hook('evlog:emit:keep', plugin.keep)
  nitroApp.hooks.hook('evlog:enrich', plugin.enrich)
})
