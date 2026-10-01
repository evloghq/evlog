import { getAdapter } from '../adapters/index'
import { HANDLER_KINDS } from './types'
import type { MapRule } from './types'

/**
 * Does this entry point contribute a wide event?
 *
 * The wording depends on what the framework integration already does. With
 * evlog's Nitro plugin an event is emitted for every request whether the
 * handler asks or not, so "this handler is invisible" would be false there —
 * the event exists, it just carries nothing but method, path and status.
 */
export const wideEventRule = {
  id: 'wide-event',
  category: 'requirement',
  title: 'logger',
  expects: 'useLogger',
  question: 'Does this entry point emit a wide event?',
  weight: 40,
  docs: '/learn/wide-events',
  appliesTo: { kinds: HANDLER_KINDS },

  fixSlot: 'setup',
  suggest({ framework }) {
    return [getAdapter(framework).loggerCall]
  },

  create(context) {
    const { facts, capabilities } = context
    return {
      onEnd() {
        /* An evlog wrapper instruments the handler without naming a logger —
           `withEvlog` is how evlog documents its own Next.js integration. */
        if (facts.loggerInit || facts.evlogWrappers.size > 0) return

        if (!context.hasEvlog) {
          context.report({ message: 'evlog not installed — adopt evlog for wide events' })
          return
        }
        context.report({
          message: capabilities.requestLogger === 'ambient'
            ? 'handler adds nothing to its request event — only method, path and status are recorded'
            : 'no useLogger() — handler is a dark event',
        })
      },
    }
  },
} satisfies MapRule
