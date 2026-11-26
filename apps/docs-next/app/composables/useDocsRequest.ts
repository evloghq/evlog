export interface DocsRequest {
  path: string
  status: number
  ms: number
}

/** The request that brought the reader to the current page, as the page header prints it. */
export function useDocsRequest() {
  return useState<DocsRequest | undefined>('docs-request', () => undefined)
}

/**
 * Whether the reader has moved between pages yet. Set before the next page is created, so a page can
 * read it once: it arrives with motion after a navigation and never on first load.
 */
export function useDocsNavigated() {
  return useState('docs-navigated', () => false)
}
