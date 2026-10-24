import { createBrowserDrain } from 'evlog/browser'

export function wrap(createBrowserDrain: () => void) {
  return createBrowserDrain
}
export const drain = createBrowserDrain({ endpoint: '/_evlog' })
