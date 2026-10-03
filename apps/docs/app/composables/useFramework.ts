/**
 * The framework the reader picked in any `::framework-tabs` group, shared by
 * every group on the site. A cookie rather than localStorage so the server
 * renders the chosen framework on first paint and hydration has nothing to fix.
 */
export function useFramework() {
  return useCookie<string | undefined>('evlog-framework', {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
}
