/**
 * The evlog tell corpus.
 *
 * Ids match `.agents/skills/write-evlog-content/references/ai-tells.md` so the
 * scanner and the reviewing model share one vocabulary. A hit here is a
 * candidate, never a verdict: the skill entry for each id carries the legitimate
 * twin that decides it.
 *
 * The vocabulary comes from the public research on machine-written prose
 * (Wikipedia's "Signs of AI writing", published word-frequency comparisons,
 * and the tics developers report about their assistants). It is generic, and it
 * is the least valuable half. What makes a finding here is the per-surface
 * budget below and the twin in the skill, both derived from reading this
 * corpus: an API reference trips half these shapes lawfully.
 */

/** @typedef {{ id: string, title: string, weight: number, phrases: string[], note?: string }} PhraseTell */

/** @type {PhraseTell[]} */
export const PHRASE_TELLS = [
  {
    id: 'T-01',
    title: 'Hollow superlative',
    weight: 2,
    phrases: [
      'seamless',
      'seamlessly',
      'effortless',
      'effortlessly',
      'powerful',
      'blazing',
      'blazingly',
      'lightning-fast',
      'cutting-edge',
      'state-of-the-art',
      'game-changing',
      'game-changer',
      'revolutionary',
      'next-level',
      'world-class',
      'best-in-class',
      'incredibly',
      'extremely',
      'virtually',
      'unparalleled',
      'unmatched',
      'elegant',
      'delightful',
      'magical',
    ],
    note: 'Legitimate when glossed by a mechanism or a measured number in the same sentence.',
  },
  {
    id: 'T-01',
    title: 'Vocabulary overrepresented in generated prose',
    weight: 1,
    phrases: [
      'leverage',
      'leveraging',
      'utilize',
      'utilizing',
      'empower',
      'empowers',
      'unlock',
      'unlocks',
      'streamline',
      'streamlines',
      'foster',
      'holistic',
      'robust',
      'comprehensive',
      'multifaceted',
      'myriad',
      'plethora',
      'realm',
      'landscape',
      'paradigm',
      'transformative',
      'pivotal',
      'crucial',
      'underscores',
      'delve',
      'tapestry',
      'testament',
      'meticulously',
      'intricate',
      'vibrant',
      'resonate',
      'captivating',
    ],
    note: 'Weak on its own. Two or more in one section is the signal.',
  },
  {
    id: 'T-04',
    title: 'Not just X, it is Y',
    weight: 2,
    phrases: [
      "isn't just",
      'is not just',
      "isn't only",
      'not only a',
      'not merely',
      "it's not about",
      'it is not about',
      "isn't a logger",
      'more than just',
    ],
  },
  {
    id: 'T-08',
    title: 'Throat-clearing',
    weight: 2,
    phrases: [
      "it's important to note",
      'it is important to note',
      "it's worth noting",
      'it is worth noting',
      'it should be noted',
      'keep in mind that',
      'that being said',
      'with that in mind',
      'in conclusion',
      'in summary',
      'at the end of the day',
      'needless to say',
      'as we can see',
      "let's dive in",
      "let's dive into",
      "let's explore",
      "let's take a look",
      'without further ado',
    ],
  },
  {
    id: 'T-08',
    title: 'Hedge on a mechanism',
    weight: 1,
    phrases: [
      'typically',
      'generally',
      'in most cases',
      'usually',
      'more often than not',
      'tends to',
      'can sometimes',
      'may sometimes',
      'should generally',
    ],
    note: 'Legitimate when what varies is named: runtime, framework, user configuration.',
  },
  {
    id: 'T-13',
    title: 'Assistant framing',
    weight: 3,
    phrases: [
      'great question',
      'certainly!',
      'absolutely!',
      'i hope this helps',
      'let me know if',
      "here's a breakdown",
      "let's break it down",
      'in this article',
      'in this guide, we will',
      'in this post we will',
      'by the end of this',
      'as an ai',
    ],
    note: 'No twin outside a ::prompt block. Flag every occurrence.',
  },
  {
    id: 'T-09',
    title: 'Universal opener',
    weight: 2,
    phrases: [
      'in today',
      'in the modern era',
      'in the world of',
      'in the ever-evolving',
      'ever-changing landscape',
      'every application',
      'every developer knows',
      'as developers, we',
      'we all know that',
    ],
    note: 'Only a tell in the first paragraph of a page or a section.',
  },
  {
    id: 'T-15',
    title: 'Retired entry point',
    weight: 3,
    phrases: ['evlog/shared', 'evlog/browser'],
    note: 'Always critical. The public names are evlog/toolkit and evlog/http.',
  },
]

/**
 * evlog's own vocabulary (U-15). Each entry is a thing evlog named, and the
 * words people reach for instead.
 *
 * Every one of these has a lawful twin, which is why they are candidates and
 * not rules: `transport` is pino's word and a comparison page has to use it,
 * `child logger` is what the reader arrives knowing. The finding is a page
 * using the other name for evlog's own concept.
 */
export const TERMINOLOGY = [
  // `transport` is deliberately absent. It is pino's word for a destination and
  // also the plain English word for moving bytes, and on this corpus every
  // occurrence was the second: an HTTP transport, a migration paragraph about
  // pino, HyperDX's own exporter. A tell that only produces its own false
  // positives trains a reviewer to skim the list.
  { canonical: 'drain', wrong: ['log sink', 'sink', 'exporter'] },
  { canonical: 'enricher', wrong: ['enrichment plugin', 'enrichment hook', 'context provider'] },
  { canonical: 'error catalog', wrong: ['error registry', 'error map', 'error dictionary'] },
  { canonical: 'log.fork()', wrong: ['child logger', 'sub-logger', 'subloggers'] },
  { canonical: 'wide event', wrong: ['wide log', 'fat event', 'mega event'] },
]

/** Tools evlog is compared against. A claim about one of these is a claim about someone else's software (U-12). */
export const ALTERNATIVES = [
  'pino',
  'winston',
  'bunyan',
  'consola',
  'logtape',
  'loglayer',
  'signale',
  'log4js',
  'roarr',
  'opentelemetry',
  'otel',
]

/** Words that turn naming an alternative into a claim about it. */
const COMPARATIVE = /\b(unlike|whereas|slower|faster|heavier|lighter|worse|better|lacks?|cannot|can['’]t|does ?n[o'’]t|has no|have no|beats?|outperforms?)\b/i

/**
 * Comparatives that only compare what follows them. `Without setup,
 * OpenTelemetry export is untouched` states a condition on evlog's own
 * behaviour, and the tool named after the comma is its subject, not its target.
 */
const DIRECTED = /\b(without|instead of)\s+((?:\w+\s+){0,3}\w+)/i

const CONTRACTION = /\b[A-Za-z]+['’](s|t|re|ve|ll|d|m)\b/g
const EXPANDED = /\b(do not|does not|did not|is not|are not|was not|were not|cannot|can not|will not|would not|should not|could not|have not|has not|had not|it is|that is|there is|you are|we are|they are|you will|we will|let us)\b/gi

/**
 * The alternative this sentence makes a claim about, or null when it only names
 * one. Whether the claim is backed is decided by the caller, which has the
 * page's links.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function comparativeClaim(text) {
  const lower = text.toLowerCase()
  const tool = ALTERNATIVES.find(name => new RegExp(`\\b${name}\\b`).test(lower))
  if (!tool) return null
  if (COMPARATIVE.test(text)) return tool
  const directed = lower.match(DIRECTED)
  return directed && new RegExp(`\\b${tool}\\b`).test(directed[2]) ? tool : null
}

/**
 * Products whose own pipelines evlog documents. A term owned by one of these is
 * their word for their own part, not evlog's concept renamed.
 */
const FOREIGN_OWNERS = [
  ...ALTERNATIVES,
  'otlp',
  'otlphttp',
  'otlpgrpc',
  'collector',
  'hyperdx',
  'sazabi',
  'datadog',
  'axiom',
  'posthog',
  'sentry',
  'loki',
  'clickhouse',
  'better stack',
]

/**
 * Names evlog gave a concept, used under someone else's name.
 *
 * A paragraph that names another product is documenting that product's
 * pipeline, and `otlphttp`'s exporter is a key in a collector config rather than
 * evlog's drain renamed. The owner is looked for across `context`, since a
 * paragraph names the product once and then keeps describing it.
 *
 * @param {string} text
 * @param {string} [context] Prose around the sentence. Defaults to the sentence.
 * @returns {{ canonical: string, wrong: string }[]}
 */
export function offNameTerms(text, context = text) {
  const lower = text.toLowerCase()
  const owned = new RegExp(`\\b(?:${FOREIGN_OWNERS.join('|')})\\b`).test(context.toLowerCase())
  const hits = []

  for (const entry of TERMINOLOGY) {
    for (const wrong of entry.wrong) {
      const term = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (owned || !new RegExp(`\\b${term}\\b`).test(lower)) continue
      hits.push({ canonical: entry.canonical, wrong })
    }
  }

  return hits
}

/** Openers treated as imperative when classifying headings (T-06). */
export const IMPERATIVE_VERBS = [
  'add',
  'apply',
  'ask',
  'attach',
  'build',
  'call',
  'catch',
  'choose',
  'close',
  'collect',
  'compare',
  'configure',
  'connect',
  'consume',
  'create',
  'debug',
  'declare',
  'define',
  'delete',
  'deploy',
  'disable',
  'drain',
  'emit',
  'enable',
  'export',
  'expose',
  'extend',
  'fail',
  'find',
  'fix',
  'follow',
  'forward',
  'get',
  'handle',
  'import',
  'inspect',
  'install',
  'instrument',
  'join',
  'keep',
  'make',
  'measure',
  'merge',
  'move',
  'narrow',
  'open',
  'pick',
  'prove',
  'publish',
  'reach',
  'read',
  'redact',
  'register',
  'rename',
  'render',
  'replace',
  'reset',
  'resolve',
  'restore',
  'retry',
  'reuse',
  'rotate',
  'run',
  'sample',
  'send',
  'set',
  'ship',
  'silence',
  'skip',
  'spawn',
  'stamp',
  'start',
  'stop',
  'strip',
  'test',
  'track',
  'trim',
  'try',
  'tune',
  'turn',
  'tweak',
  'update',
  'upgrade',
  'use',
  'validate',
  'verify',
  'wire',
  'wrap',
  'write',
]

/**
 * Contraction opportunities in a span: what was contracted, and what could have
 * been. The ratio is only meaningful with a handful of opportunities.
 *
 * @param {string} text
 * @returns {{ contracted: number, expanded: number }}
 */
export function contractionCounts(text) {
  return {
    contracted: (text.match(CONTRACTION) ?? []).length,
    expanded: (text.match(EXPANDED) ?? []).length,
  }
}

/**
 * Locate every phrase tell in a span.
 *
 * @param {string} text
 * @param {number} line
 * @returns {{ id: string, title: string, weight: number, phrase: string, line: number, excerpt: string }[]}
 */
export function findPhrases(text, line, context = '') {
  const hits = []
  const haystack = text.toLowerCase()

  for (const tell of PHRASE_TELLS) {
    for (const phrase of tell.phrases) {
      let from = 0
      for (;;) {
        const at = haystack.indexOf(phrase, from)
        if (at === -1) break
        from = at + phrase.length
        if (!isWordBoundary(haystack, at, phrase)) continue
        hits.push({
          id: tell.id,
          title: tell.title,
          weight: tell.weight,
          phrase,
          line,
          excerpt: context || excerptAround(text, at, phrase.length),
        })
      }
    }
  }

  return hits
}

/**
 * @param {string} haystack
 * @param {number} at
 * @param {string} phrase
 * @returns {boolean}
 */
function isWordBoundary(haystack, at, phrase) {
  const before = haystack[at - 1]
  const after = haystack[at + phrase.length]
  const isWord = /[a-z0-9]/
  if (before && isWord.test(before)) return false
  if (after && isWord.test(after) && !phrase.endsWith('/')) return false
  return true
}

/**
 * @param {string} text
 * @param {number} at
 * @param {number} length
 * @returns {string}
 */
function excerptAround(text, at, length) {
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}
