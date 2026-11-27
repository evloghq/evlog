export interface ProductFacts {
  /** Entry point the reader imports from, e.g. `evlog/axiom`. */
  entry?: string
  /** npm package, when it is not the entry point itself. */
  package?: string
  /** `stable`, `beta` or `early`: how much the API can still move. */
  status?: 'stable' | 'beta' | 'early'
  /** The CLI command, for products that are a command rather than an import. */
  command?: string
}

type Node = string | [tag: string, props: Record<string, unknown>, ...children: unknown[]]

/** Splits a page's top-level `::product-facts` out of its body, so the header can draw it. */
export function takeFacts<T>(nodes: T[]): { facts?: ProductFacts, nodes: T[] } {
  const at = nodes.findIndex(node => Array.isArray(node) && (node as Node)[0] === 'product-facts')
  if (at < 0) return { nodes }
  return {
    facts: (nodes[at] as Exclude<Node, string>)[1] as ProductFacts,
    nodes: nodes.filter((_, i) => i !== at),
  }
}

/** A path as its segments, each linked when it is a page of its own. The last one is the page being read. */
export function pathSegments(path: string, pages: Set<string>) {
  const names = path.split('/').filter(Boolean)
  return names.map((name, i) => {
    const to = `/${names.slice(0, i + 1).join('/')}`
    return { name, to: i < names.length - 1 && pages.has(to) ? to : undefined }
  })
}

/** A duration as evlog prints it at the end of an event's first line. */
export function formatTook(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

/**
 * Times the reader's navigations. A page that finishes rendering is matched to the navigation by its
 * path, so the page being left can still finish after the next one was asked for.
 */
export function createRequestClock() {
  let pending: { path: string, at: number } | undefined
  return {
    start(path: string, now: number) {
      pending = { path, at: now }
    },
    finish(path: string, now: number) {
      if (pending?.path !== path) return undefined
      const ms = now - pending.at
      pending = undefined
      return { path, ms }
    },
    get navigating() {
      return Boolean(pending)
    },
  }
}

/** How long the header's rule takes to draw: the request's own duration, kept watchable. */
export function drawTime(ms: number) {
  return Math.min(Math.max(Math.round(ms), 160), 600)
}

// Left side bearing of Geist's stem capitals in em, measured at weight 560. Diagonals and rounds carry
// 0.04em or less and stay where they are.
const BEARING: Record<string, number> = {
  B: 0.08, D: 0.08, E: 0.08, F: 0.08, H: 0.08, I: 0.08, K: 0.08, L: 0.08, M: 0.08, N: 0.08, P: 0.08, R: 0.08,
  U: 0.06, J: 0.05, S: 0.05,
}

// What a diagonal keeps, so every title starts the same distance from the column edge.
const KEPT = 0.02

/**
 * How far, in em, a title moves left so its first stroke sits on the column edge.
 * A stem (`E`, `D`, `N`) starts further in than a diagonal (`A`, `T`), which shows at display size.
 */
export function opticalHang(text: string) {
  const bearing = BEARING[text.trimStart().charAt(0)]
  return bearing ? Number((bearing - KEPT).toFixed(3)) : 0
}
