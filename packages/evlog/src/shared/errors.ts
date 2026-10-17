/**
 * The HTTP status an error answers with: `status`, then `statusCode`, and 500
 * when neither is set. This is the one place the 500 default lives. An
 * EvlogError with no `status` is not an HTTP response of its own, so only the
 * framework boundary applies the default.
 *
 * Works with any error shape (H3, Nitro, EvlogError, plain objects).
 *
 * @beta This function is part of the evlog toolkit API for building custom framework integrations.
 */
export function extractErrorStatus(error: unknown): number {
  if (error === null || typeof error !== 'object') return 500
  const raw = (error as { status?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode
  const status = Number(raw)
  return Number.isFinite(status) ? status : 500
}
