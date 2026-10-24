import { DOCS_URL } from '../../core/output'

/** The migration guide section a finding links to: `v3/nitro-entry-points` → `…/migrate/v3#nitro-entry-points`. */
export function docsUrlFor(id: string): string {
  const [major, slug] = id.split('/')
  return `${DOCS_URL}/migrate/${major}${slug ? `#${slug}` : ''}`
}
