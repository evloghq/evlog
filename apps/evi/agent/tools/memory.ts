import { useLogger } from 'evlog/eve'
import type { DynamicResolveContext } from 'eve/tools'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { memoryAvailable } from '../lib/memory/config'
import { surfaceOf } from '../lib/memory/identity'
import { MemoryRejected } from '../lib/memory/policy'
import { writableTarget } from '../lib/memory/scope'
import { openMemorySession } from '../lib/memory/session'
import type { MemorySource } from '../lib/memory/types'
import { DEFAULT_SEARCH_LIMIT, MAX_MEMORY_TEXT_LENGTH, MAX_MEMORY_TITLE_LENGTH } from '../lib/memory/types'
import { channelName } from '../lib/channel'

const REMEMBER_DESCRIPTION = `Remember one durable fact for future sessions. Reach for it when someone tells you something worth knowing next time, or asks you to remember it.

**What belongs here:** who someone is and how they want to be worked with; a decision and the reason an alternative lost; a constraint that outlives this conversation.

**What does not, and where it goes instead:**
- Anything a release could change — an API name, an option, a default, a CLI flag. Those are retrieved every time, never remembered.
- Anything every contributor and coding agent in the repository needs: commit conventions, the Definition of Done, the changeset policy. That is what \`AGENTS.md\` is for, so open a pull request against it instead. Storing it here would hide it from everyone else working in the repo.
- Task state inside this conversation. That is what the conversation is for.
- Secrets and credentials, which are refused outright.

Say once, plainly, that you saved it. Do not read it back.`

// The resolver's result is serialized for park/replay, so its executes must
// not close over the live store or auth (that is what dropped the whole
// toolset in production, one failure per turn.started since eve 0.46): they
// re-open the memory session per call and re-read auth from the tool context,
// the same rebind rule the push tool follows in tools/git.ts.
const resolveMemoryTools = async (_event: unknown, ctx: DynamicResolveContext) => {
  if (!memoryAvailable()) return null
  const auth = ctx.session.auth.current

  // An autonomous turn sees no tools; a store that cannot answer costs
  // the tools, never the turn.
  let session
  try {
    session = await openMemorySession(auth)
  } catch (error) {
    console.error('[evi:memory] tools unavailable', error)
    return null
  }
  if (session === null) return null

  const source: MemorySource = {
    surface: surfaceOf(channelName(ctx.channel.kind)),
    sessionId: ctx.session.id,
    url: null,
  }
  const personId = session.personId

  // The store lives outside the closures: every execute re-opens the memory
  // session. Returns null when the store went away between resolve and call,
  // so a call costs a refusal, never a throw.
  const reopen = async (toolCtx: { session: { auth: { current: typeof auth } } }) => {
    try {
      return await openMemorySession(toolCtx.session.auth.current)
    } catch (error) {
      console.error('[evi:memory] store unavailable at call time', error)
      return null
    }
  }

  return {
    memory__remember: defineTool({
      description: REMEMBER_DESCRIPTION,
      inputSchema: z.object({
        text: z.string().trim().min(1).max(MAX_MEMORY_TEXT_LENGTH)
          .describe('The fact, stated so it still reads correctly months from now.'),
        title: z.string().trim().max(MAX_MEMORY_TITLE_LENGTH).optional()
          .describe('A short label, when the fact benefits from one.'),
        about: z.enum(['person', 'agent']).default('person')
          .describe('`person` for a fact about whoever you are talking to; `agent` for how you should work.'),
        supersedes: z.string().uuid().optional()
          .describe('The id of a memory this one corrects. The old one stops being used and stays readable as history.'),
      }),
      async execute(input, toolCtx) {
        const log = useLogger(toolCtx)
        const session = await reopen(toolCtx)
        if (session === null) {
          log.set({ memory: { refused: 'store_unavailable' } })
          return { success: false as const, error: 'The memory store is not reachable for this session.' }
        }
        const target = writableTarget(toolCtx.session.auth.current, input.about, personId)
        if (target === null) {
          log.set({ memory: { refused: 'not_writable' } })
          return { success: false as const, error: 'This session cannot write memories.' }
        }
        try {
          const record = await session.store.remember({
            ...target,
            text: input.text,
            ...(input.title ? { title: input.title } : {}),
            ...(input.supersedes ? { supersedes: input.supersedes } : {}),
            sourceKind: 'stated',
            source: { ...source },
            createdBy: toolCtx.session.auth.current?.principalId ?? 'unknown',
          })
          log.set({ memory: { saved: input.about } })
          return { success: true as const, id: record.id, about: input.about }
        } catch (error) {
          if (error instanceof MemoryRejected) {
            log.set({ memory: { refused: error.reason } })
            return { success: false as const, reason: error.reason, error: error.message }
          }
          throw error
        }
      },
    }),

    memory__search: defineTool({
      description: 'Search remembered facts, including ones that have since been corrected. The facts already in your context are the recent ones; reach for this when you need something older, or want to check what was believed at some point.',
      inputSchema: z.object({
        query: z.string().trim().min(2).describe('Words to match against remembered facts.'),
        limit: z.number().int().min(1).max(25).default(DEFAULT_SEARCH_LIMIT),
      }),
      async execute(input, toolCtx) {
        const session = await reopen(toolCtx)
        if (session === null) {
          return { success: false as const, error: 'The memory store is not reachable for this session.' }
        }
        const records = await session.store.search(session.targets, input.query, input.limit)
        useLogger(toolCtx).set({ memory: { searched: true, hits: records.length } })
        return {
          success: true as const,
          memories: records.map(record => ({
            id: record.id,
            title: record.title,
            text: record.text,
            current: record.invalidatedAt === null && (record.validTo === null || record.validTo > new Date()),
            recordedOn: record.source.surface,
            updatedAt: record.updatedAt.toISOString(),
          })),
        }
      },
    }),

    memory__forget: defineTool({
      description: 'Stop using a remembered fact. It stays readable as history rather than being deleted, so a correction never loses what came before. Use `memory__remember` with `supersedes` when there is a replacement.',
      inputSchema: z.object({
        id: z.string().uuid().describe('The id of the memory to stop using.'),
      }),
      async execute(input, toolCtx) {
        const session = await reopen(toolCtx)
        if (session === null) {
          return { success: false as const, error: 'The memory store is not reachable for this session.' }
        }
        const forgotten = await session.store.forget(session.targets, input.id)
        return forgotten
          ? { success: true as const, forgotten: true as const }
          : { success: false as const, error: 'No live memory with that id in this session.' }
      },
    }),
  }
}

// Session scope alongside turn scope: eve rebinds only session-scoped
// resolvers when it replays a call parked in a process that is gone, and a
// memory write can be the last thing a long run does. `execute` re-reads auth
// from the tool context, so the wider scope grants nothing the per-turn gate
// would refuse.
export default defineDynamic({
  events: {
    'session.started': resolveMemoryTools,
    'turn.started': resolveMemoryTools,
  },
})
