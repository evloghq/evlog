import adapter from '@sveltejs/adapter-node'
import { sveltekit } from '@sveltejs/kit/vite'
import evlog from 'evlog/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
    }),
    evlog({
      service: 'sveltekit-example',
      pretty: true,
      sourceLocation: true,
    }),
  ],
})
