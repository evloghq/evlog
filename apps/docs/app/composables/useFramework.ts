/**
 * The framework the reader picked in any `::framework-tabs` group. A cookie so
 * the inline head script in `plugins/framework-choice.ts` can read it before
 * first paint; the prerendered HTML itself never depends on it.
 */
export function useFramework() {
  return useCookie<string | undefined>('evlog-framework', {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
}
