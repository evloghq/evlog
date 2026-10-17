const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Whether a URL names this machine. The whole hostname must match:
 * `https://localhost.evil.com` is not local.
 */
export function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).hostname)
  } catch {
    return false
  }
}
