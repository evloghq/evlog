import { get } from '@vercel/global-config'

/** Key looked up in the connected Global Config store for the pinned production content SHA. */
const PINNED_SHA_KEY = 'contentSha'

/**
 * The content SHA pinned in Vercel Global Config, if any.
 */
export async function getPinnedSha(): Promise<string | undefined> {
  if (!process.env.GLOBAL_CONFIG) return undefined
  try {
    const sha = await get<string>(PINNED_SHA_KEY)
    return sha || undefined
  } catch (error) {
    console.error('[content] failed to read pinned SHA from Global Config', error)
    return undefined
  }
}
