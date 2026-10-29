import { definePlugin } from 'nitro'

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('error', async () => {
    await new Promise<void>(resolve => setImmediate(resolve))
  })
})
