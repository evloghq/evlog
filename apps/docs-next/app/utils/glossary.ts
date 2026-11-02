export interface GlossaryTerm {
  term: string
  /** One or two sentences, in the glossary's words. */
  text: string
  /** Where the term shows up in code. */
  code: string
  /** The page that explains it. */
  to: string
}

/** The terms `:term[...]{of="..."}` can point at. The wording follows the Glossary page. */
export const glossary = {
  'wide-event': {
    term: 'wide event',
    text: 'One event per unit of work, with every field the work touched. A request, a job or a script run collects its fields and evlog writes them once, when it ends.',
    code: 'log.set()',
    to: '/events',
  },
  'drain': {
    term: 'drain',
    text: 'Where events leave the process. You name one in evlog.config.ts and every route, job and script sends its events there.',
    code: 'createAxiomDrain()',
    to: '/drains',
  },
  'enricher': {
    term: 'enricher',
    text: 'Adds fields to an event before it is emitted, such as the user agent or the region. It is not in the request chain.',
    code: 'evlog:enrich',
    to: '/events/enrichers',
  },
  'pipeline': {
    term: 'pipeline',
    text: 'Batching, retry and buffering around a drain, so one HTTP call carries many events and a failed send is tried again.',
    code: 'createDrainPipeline()',
    to: '/drains',
  },
  'error-catalog': {
    term: 'error catalog',
    text: 'Errors you throw from several places, named once with their status, why and fix, and typed wherever they are used.',
    code: 'defineErrorCatalog()',
    to: '/errors/catalogs',
  },
} satisfies Record<string, GlossaryTerm>

export type GlossaryKey = keyof typeof glossary
