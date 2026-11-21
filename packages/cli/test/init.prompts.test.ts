import { describe, expect, it, vi } from 'vitest'
import { askVercelConnector } from '../src/lib/init/prompts'

const clack = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
}))
vi.mock('@clack/prompts', async importOriginal => ({ ...await importOriginal<typeof import('@clack/prompts')>(), ...clack }))

describe('askVercelConnector', () => {
  const reusable = [{ uid: 'vercel/mcp', type: 'api-key' }]

  it('asks for the new connector\'s name, pre-filled with the suggestion, and creates the name entered', async () => {
    clack.select.mockResolvedValueOnce('\0create')
    clack.text.mockResolvedValueOnce('logs-reader')

    const choice = await askVercelConnector('prj_1', reusable, new Set(), 'vercel/evlog')

    expect(choice).toEqual({ connector: 'vercel/logs-reader', create: true })
    const asked = clack.text.mock.lastCall![0] as { initialValue: string, validate: (value: string) => string | undefined }
    expect(asked.initialValue).toBe('evlog')
    expect(asked.validate('mcp')).toBe('The team already has vercel/mcp')
    expect(asked.validate('no/slash')).toBeDefined()
    expect(asked.validate('evlog')).toBeUndefined()
  })

  it('uses a connector the team has without asking for a name', async () => {
    clack.select.mockResolvedValueOnce('vercel/mcp')
    clack.text.mockClear()

    expect(await askVercelConnector('prj_1', reusable, new Set(['vercel/mcp']), 'vercel/evlog')).toEqual({ connector: 'vercel/mcp', create: false })
    expect(clack.text).not.toHaveBeenCalled()
  })
})
