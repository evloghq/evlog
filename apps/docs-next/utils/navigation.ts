import type { NavigationItem } from 'comark-content'

/**
 * First leaf page under the navigation node at `path`, if `path` is a section (directory) node.
 * Returns `undefined` when the path isn't in the tree or already is a leaf — used to redirect
 * directory URLs like `/getting-started` to their first page.
 */
export function findFirstLeaf(
  navigation: NavigationItem[] | undefined | null,
  path: string | undefined
): string | undefined {
  if (!navigation?.length || !path) return undefined
  const visit = (items: NavigationItem[]): string | undefined => {
    for (const item of items) {
      if (item.path === path) {
        let current = item
        while (current.children?.length) current = current.children[0]!
        // Guard: a directory `index.md` is emitted as its own first child — no redirect to self.
        return current.path !== path ? current.path : undefined
      }
      if (item.children?.length) {
        const found = visit(item.children)
        if (found) return found
      }
    }
    return undefined
  }
  return visit(navigation)
}
