import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro'

export default defineConfig({
  serverDir: './',
  modules: [
    evlog({
      env: {
        service: 'nitro-playground'
      }
    })
  ],
})
