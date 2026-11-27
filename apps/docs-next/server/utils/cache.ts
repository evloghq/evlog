import type { Driver } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import vercelRuntimeCache from 'unstorage/drivers/vercel-runtime-cache'

/** Whether the Vercel Runtime Cache is available (i.e. running on Vercel). */
function cacheAvailable(): boolean {
  return !import.meta.dev && Boolean(process.env.VERCEL)
}

/** Every namespace below degrades to per-process memory off Vercel if not available. */
function runtimeCacheDriver(base: string, ttl?: number): Driver {
  if (!cacheAvailable()) return memoryDriver()
  return vercelRuntimeCache({ base, ttl })
}

/**
 * Bump when content parser/plugin configuration, relevant parser dependencies, or cached derived
 * data changes. Keeping this explicit lets unrelated deployments reuse immutable content artifacts.
 */
export const CONTENT_PARSER_VERSION = 'v7'

/** The parser version, plus a hash of `highlighter.ts`. */
function parserVersion(): string {
  const { highlighterVersion } = useRuntimeConfig().docs
  return highlighterVersion ? `${CONTENT_PARSER_VERSION}-${highlighterVersion}` : CONTENT_PARSER_VERSION
}

/**
 * A ref pinned via `withRef()` is treated as immutable, so it can be cached for a long time.
 */
const IMMUTABLE_TTL = 60 * 60 * 24

/**
 * Comark cache: index, parsed bodies and artifacts of every commit.
 * Base namespace is per parser version and keys are per-sha.
 */
export function contentCacheDriver(): Driver {
  return runtimeCacheDriver(`content:${parserVersion()}`, IMMUTABLE_TTL)
}

/**
 * Shared driver backing branch pointers and preview authorization decisions (`github.ts`).
 * The branch is mutable, so the TTL is bounded. Vercel Runtime Cache is regional.
 */
export function refCacheDriver(ttl: number): Driver {
  return runtimeCacheDriver('content:refs:v2', ttl)
}
