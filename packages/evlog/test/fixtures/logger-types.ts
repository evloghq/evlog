import { log } from '../../src/logger'
import { useLogger as useNextLogger } from '../../src/next/storage'
import { createLoggerStorage } from '../../src/shared/storage'
import { useLogger as useElysiaLogger } from '../../src/elysia'

interface Context { user: { id: string } }

log.error(new Error('failed'))
const nextLogger = useNextLogger<Context>()
nextLogger.set({ user: { id: 'u1' } })
const nextId: string | undefined = nextLogger.getContext().user?.id
// @ts-expect-error User IDs remain strings in typed request contexts.
nextLogger.set({ user: { id: 123 } })

const { useLogger } = createLoggerStorage('test context')
const sharedLogger = useLogger<Context>()
sharedLogger.set({ user: { id: 'u2' } })
const sharedId: string | undefined = sharedLogger.getContext().user?.id
// @ts-expect-error User IDs remain strings in typed request contexts.
sharedLogger.set({ user: { id: 123 } })

void nextId
void sharedId

const elysiaLogger = useElysiaLogger<Context>()
elysiaLogger.set({ user: { id: 'u3' } })
const elysiaId: string | undefined = elysiaLogger.getContext().user?.id
// @ts-expect-error User IDs remain strings in typed request contexts.
elysiaLogger.set({ user: { id: 123 } })
void elysiaId
