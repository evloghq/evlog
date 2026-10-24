import { createHttpDrain as createBrowserDrain } from 'evlog/http'

export function wrap(createBrowserDrain: () => void) {
  return createBrowserDrain
}
export const drain = createBrowserDrain({ endpoint: '/_evlog' })
