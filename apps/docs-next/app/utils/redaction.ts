export interface RedactionField {
  key: string
  raw: string
  masked?: string
  /** The built-in that matched: a value pattern, or `secrets` for a key ending in a secret word. */
  rule?: string
}

/** The Redaction figure's rows. `masked` is what evlog's built-ins make of `raw` under that key. */
export const redactionFields: RedactionField[] = [
  { key: 'user.id', raw: '42' },
  { key: 'user.email', raw: 'alice@example.com', masked: 'a***@***.com', rule: 'email' },
  { key: 'user.phone', raw: '+33 6 12 34 56 78', masked: '+33******78', rule: 'phone' },
  { key: 'user.ip', raw: '192.168.1.42', masked: '***.***.***.42', rule: 'ipv4' },
  { key: 'payment.card', raw: '4111111111111111', masked: '****1111', rule: 'creditCard' },
  { key: 'webhook.header', raw: 'Bearer sk_live_abc123def', masked: 'Bearer ***', rule: 'bearer' },
  { key: 'db.url', raw: 'postgres://app:hunter2@db:5432', masked: 'postgres://app:***@db:5432', rule: 'urlPassword' },
  { key: 'account.password', raw: 'hunter2-correct-horse', masked: '[REDACTED]', rule: 'secrets' },
  { key: 'cart.total', raw: '9999' },
]
