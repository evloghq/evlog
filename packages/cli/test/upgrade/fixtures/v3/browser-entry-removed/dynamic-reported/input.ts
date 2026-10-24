export * from 'evlog/browser'

export async function load() {
  const { createBrowserDrain } = await import('evlog/browser')
  return createBrowserDrain
}
