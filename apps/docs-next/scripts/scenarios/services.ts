// What the scenarios call in place of a database, a payment provider and a queue consumer.

const users: Record<string, { id: string, plan: string }> = {
  usr_123: { id: 'usr_123', plan: 'pro' },
}

const staff: Record<string, { id: string, email: string, refunds: boolean }> = {
  usr_123: { id: 'usr_123', email: 'alice@example.com', refunds: true },
  usr_456: { id: 'usr_456', email: 'bob@example.com', refunds: false },
}

export const db = {
  findCart: (id: string) => Promise.resolve({ id, userId: 'usr_123', items: ['sku_1', 'sku_2', 'sku_3'], total: 9999 }),
  findUser: (id: string) => Promise.resolve(users[id]),
  findInvoice: (id: string) => Promise.resolve({ id, total: 4900 }),
  findStaff: (id: string) => {
    const member = staff[id]!
    return Promise.resolve({ id: member.id, email: member.email, canRefund: (_invoice: { id: string }) => member.refunds })
  },
}

export const payments = {
  charge: (_total: number) => Promise.resolve({ success: false, declineReason: 'Card declined by issuer' }),
}

export function sync() {
  return Promise.resolve(Array.from({ length: 1250 }, (_, index) => ({ id: index })))
}

export function processMessage(_message: unknown) {
  return Promise.resolve()
}
