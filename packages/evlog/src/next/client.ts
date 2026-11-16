'use client'

import { useEffect } from 'react'
import type { LogLevel, TransportConfig } from '../types'
import { initLog } from '../runtime/client/log'

export { log, setIdentity, clearIdentity, setMinLevel } from '../runtime/client/log'

export interface EvlogProviderProps {
  /**
   * Service name for client-side logs.
   * @default 'client'
   */
  service?: string

  /**
   * Enable pretty printing in the browser console.
   * @default true
   */
  pretty?: boolean

  /**
   * Transport configuration for sending client logs to the server.
   */
  transport?: TransportConfig

  /**
   * Enable or disable client-side logging.
   * @default true
   */
  enabled?: boolean

  /**
   * Enable or disable browser console output.
   * When false, logs are suppressed in the browser DevTools console
   * but still sent to the server via transport (if enabled).
   * @default true
   */
  console?: boolean

  /**
   * Minimum severity for client `log` calls (debug < info < warn < error).
   * @default 'debug'
   */
  minLevel?: LogLevel

  children: React.ReactNode
}

/**
 * React provider that initializes evlog client-side logging.
 * Place this in your root layout to enable client logging throughout your app.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { EvlogProvider } from 'evlog/next/client'
 *
 * export default function Layout({ children }) {
 *   return (
 *     <EvlogProvider service="my-app" transport={{ enabled: true }}>
 *       {children}
 *     </EvlogProvider>
 *   )
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function EvlogProvider({ service, pretty, transport, enabled, console: consoleOutput, minLevel, children }: EvlogProviderProps) {
  useEffect(() => {
    initLog({
      enabled,
      console: consoleOutput,
      pretty,
      minLevel,
      service,
      transport,
    })
  }, [enabled, consoleOutput, pretty, minLevel, service, transport])

  return children
}
