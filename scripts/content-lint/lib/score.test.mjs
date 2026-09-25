import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './mdc.mjs'
import { measure } from './metrics.mjs'
import { buildBaseline, evaluate } from './score.mjs'

const page = (path, source, drift = []) => ({
  path,
  metrics: measure(parseMarkdown(source)),
  drift,
})

const quiet = { sample: 0, epigramRatio: 0 }

describe('buildBaseline', () => {
  it('ignores pages too short to speak for the corpus', () => {
    const baseline = buildBaseline([page('a.md', 'Short.')])

    expect(baseline.sample).toBe(0)
  })

  it('gives a surface its own median once enough of it exists', () => {
    const closer = 'The pipeline batches every event before it leaves the process. That is the whole idea.'
    const loose = Array.from({ length: 14 }, () => closer).join('\n\n')
    const tight = Array.from({ length: 14 }, () => 'The drain batches the events it receives. It retries the batch 3 times before it drops it.').join('\n\n')

    const baseline = buildBaseline([
      ...Array.from({ length: 6 }, (_value, index) => page(`apps/docs/content/blog/${index}.md`, loose)),
      ...Array.from({ length: 6 }, (_value, index) => page(`apps/docs/content/8.reference/${index}.md`, tight)),
    ])

    expect(baseline.bySurface.blog.epigramRatio).toBeGreaterThan(baseline.bySurface.reference.epigramRatio)
  })
})

describe('heading templates', () => {
  const withHeadings = (path, headings) => page(path, headings.map(h => `## ${h}\n\nProse about it.`).join('\n\n'))

  it('subtracts the headings a page shares with its siblings', () => {
    const template = ['Installation', 'Quick Start', 'Configuration', 'Troubleshooting']
    const siblings = ['a', 'b', 'c', 'd'].map(name => withHeadings(`apps/docs/content/4.integrate/adapters/${name}.md`, template))
    const baseline = buildBaseline(siblings)

    // Four noun headings, all of them the directory's shape: not a mould.
    expect(evaluate(siblings[0], baseline).findings.map(finding => finding.id)).not.toContain('T-06')
  })

  it('still flags a page whose own headings all came from one stamp', () => {
    const template = ['Installation', 'Quick Start']
    const siblings = ['a', 'b', 'c'].map(name => withHeadings(`apps/docs/content/4.integrate/adapters/${name}.md`, template))
    const offender = withHeadings('apps/docs/content/4.integrate/adapters/d.md', [...template, 'Options', 'Reference', 'Limitations', 'Notes'])
    const baseline = buildBaseline([...siblings, offender])

    expect(evaluate(offender, baseline).findings.map(finding => finding.id)).toContain('T-06')
  })
})

describe('numbered headings', () => {
  it('reads an ordered guide as a sequence, not a mould', () => {
    const steps = ['1. Route filtering', '2. Logger creation', '3. Context accumulation', '4. Request end', '5. Emit']
    const source = steps.map(h => `## ${h}\n\nProse about the step.`).join('\n\n')

    expect(evaluate(page('apps/docs/content/2.learn/a.md', source), quiet).findings.map(f => f.id)).not.toContain('T-06')
  })

  it('still flags five noun headings that are not a sequence', () => {
    const labels = ['Configuration', 'Options', 'Reference', 'Limitations', 'Notes']
    const source = labels.map(h => `## ${h}\n\nProse about it.`).join('\n\n')

    expect(evaluate(page('apps/docs/content/2.learn/a.md', source), quiet).findings.map(f => f.id)).toContain('T-06')
  })
})

describe('T-07 boundary', () => {
  const shared = n => page('apps/docs/content/2.learn/a.md', Array.from({ length: n }, (_v, i) => `- Powerful thing number ${'x'.repeat(i * 4)}`).join('\n'))

  it('spares four bullets, where a shared opener is three of them', () => {
    expect(evaluate(shared(4), quiet).findings.map(f => f.id)).not.toContain('T-07')
  })

  it('reports five', () => {
    expect(evaluate(shared(5), quiet).findings.map(f => f.id)).toContain('T-07')
  })
})

describe('evaluate', () => {
  it('carries drift findings through and deducts for them', () => {
    const drift = [{ id: 'T-15', severity: 'critical', line: 4, message: 'gone' }]
    const result = evaluate(page('apps/docs/content/2.learn/1.a.md', 'Prose.', drift), quiet)

    expect(result.score).toBe(85)
    expect(result.findings).toHaveLength(1)
  })

  it('leaves clean prose at 100', () => {
    const result = evaluate(page('apps/docs/content/2.learn/1.a.md', 'The drain retries 3 times, then drops the batch.'), quiet)

    expect(result.score).toBe(100)
    expect(result.findings).toEqual([])
  })

  it('flags a retired entry point used as if it were current', () => {
    const result = evaluate(page('apps/docs/content/2.learn/a.md', 'Pull the helper from `evlog/browser` in your client entry.'), quiet)

    expect(result.findings.map(finding => finding.id)).toContain('T-15')
  })

  it('spares the page that documents the deprecation', () => {
    const source = 'The `evlog/browser` path is deprecated and re-exports `evlog/http`.'
    const result = evaluate(page('apps/docs/content/7.extend/a.md', source), quiet)

    expect(result.findings).toEqual([])
  })

  it('does not let a bare negation shield a retired entry point', () => {
    const source = 'Do not forget to import the helper from `evlog/shared` in your entry.'
    const result = evaluate(page('apps/docs/content/2.learn/a.md', source), quiet)

    expect(result.findings.map(finding => finding.id)).toContain('T-15')
  })

  it('still spares the sentence that retires it', () => {
    const source = 'Never use `evlog/shared`; the public entry point is `evlog/toolkit`.'

    expect(evaluate(page('AGENTS.md', source), quiet).findings.map(finding => finding.id)).not.toContain('T-15')
  })

  it('flags assistant framing on sight', () => {
    const result = evaluate(page('apps/docs/content/2.learn/1.a.md', "Great question. Here's a breakdown of the pipeline."), quiet)

    expect(result.findings.map(finding => finding.id)).toContain('T-13')
  })

  it('costs a superlative more than a merely overused word', () => {
    const superlative = evaluate(page('apps/docs/content/2.learn/a.md', 'The adapter is powerful and elegant.'), quiet)
    const overused = evaluate(page('apps/docs/content/2.learn/a.md', 'The adapter is robust and comprehensive.'), quiet)

    expect(superlative.findings.map(finding => finding.id)).toContain('T-01')
    expect(overused.findings).toEqual([])
  })

  it('flags a single em dash, whatever the rest of the corpus does', () => {
    const source = 'The drain retries — twice — before it drops the batch.'
    const alone = evaluate(page('apps/docs/content/2.learn/a.md', source), quiet)
    const inACorpusFullOfThem = evaluate(page('apps/docs/content/2.learn/a.md', source), { sample: 20, epigramRatio: 0.5 })

    expect(alone.findings.map(finding => finding.id)).toContain('U-14')
    expect(inACorpusFullOfThem.findings.map(finding => finding.id)).toContain('U-14')
  })

  it("flags evlog's own concept under another tool's name", () => {
    const result = evaluate(page('apps/docs/content/7.extend/a.md', 'Register the sink and every event reaches it.'), quiet)

    expect(result.findings.map(finding => finding.id)).toContain('U-15')
  })

  it("leaves another product its own vocabulary", () => {
    const source = "Set `endpoint` to the same value as HyperDX's `otlphttp` exporter."
    const result = evaluate(page('apps/docs/content/4.integrate/a.md', source), quiet)

    expect(result.findings.map(finding => finding.id)).not.toContain('U-15')
  })

  it('reads a condition on our own behaviour as our own', () => {
    const source = 'Without `setup`, OpenTelemetry export is untouched: eve keeps writing its local traces.'
    const result = evaluate(page('apps/docs/content/5.use-cases/a.md', source), quiet)

    expect(result.findings.map(finding => finding.id)).not.toContain('U-12')
  })

  it('still flags a claim aimed at the alternative', () => {
    const source = 'Ship the same request without OpenTelemetry and nothing downstream notices.'
    const result = evaluate(page('apps/docs/content/5.use-cases/a.md', source), quiet)

    expect(result.findings.map(finding => finding.id)).toContain('U-12')
  })

  it('spares a page whose sections list rather than argue', () => {
    const sections = ['Exit codes', 'The JSON contract', 'The map file', 'Monorepos', 'Options']
    const source = sections.map(title => `## ${title}\n\n| Key | Meaning |\n|---|---|\n| a | b |`).join('\n\n')
    const result = evaluate(page('apps/docs/content/3.cli/a.md', source), quiet)

    expect(result.findings.map(finding => finding.id)).not.toContain('T-06')
  })

  it('pins the enumerating share at its inclusive boundary', () => {
    // Five sections, so 3 lists exactly 0.6 and 2 falls under it. The rule is
    // `>= 0.6`, and this is the pair that says so.
    const titles = ['Exit codes', 'The JSON contract', 'The map file', 'Monorepos', 'Options']
    const prose = 'The gate reads the map file and compares it against the baseline the previous run wrote, so a rule that moved is never counted as a regression by mistake, and the exit code stays the contract.'
    const build = listed => titles
      .map((title, index) => `## ${title}\n\n${index < listed ? '| Key | Meaning |\n|---|---|\n| a | b |' : prose}`)
      .join('\n\n')

    const atTheBoundary = evaluate(page('apps/docs/content/3.cli/a.md', build(3)), quiet)
    const underIt = evaluate(page('apps/docs/content/3.cli/a.md', build(2)), quiet)

    expect(atTheBoundary.findings.map(finding => finding.id)).not.toContain('T-06')
    expect(underIt.findings.map(finding => finding.id)).toContain('T-06')
  })

  it('still flags one mould over sections that argue', () => {
    const sections = ['Exit codes', 'The JSON contract', 'The map file', 'Monorepos', 'Options']
    const prose = 'The gate reads the map file and compares it against the baseline the previous run wrote, so a rule that moved is never counted as a regression by mistake, and the exit code stays the contract.'
    const source = sections.map(title => `## ${title}\n\n${prose}`).join('\n\n')
    const result = evaluate(page('apps/docs/content/3.cli/a.md', source), quiet)

    expect(result.findings.map(finding => finding.id)).toContain('T-06')
  })

  it('spares the sentence that is describing the other tool', () => {
    const result = evaluate(page('apps/docs/content/8.reference/a.md', 'pino writes through a transport, which runs in a worker thread.'), quiet)

    expect(result.findings.map(finding => finding.id)).not.toContain('U-15')
  })

  it('flags a claim about another logger with nothing behind it', () => {
    const bare = evaluate(page('apps/docs/content/8.reference/a.md', "winston cannot sample, so every request pays the full write."), quiet)
    const measured = evaluate(page('apps/docs/content/8.reference/a.md', 'winston cannot sample, so all 40000 requests pay the full write.'), quiet)

    expect(bare.findings.map(finding => finding.id)).toContain('U-12')
    expect(measured.findings.map(finding => finding.id)).not.toContain('U-12')
  })

  it('judges a page we did not write on how it reads, and nothing else', () => {
    const source = 'Register the sink.\n\nThe winston logger cannot sample, so every request pays.\n\nImport it from `evlog/shared`.'
    const ours = evaluate(page('apps/docs/content/2.learn/a.md', source), quiet)
    const theirs = evaluate({ ...page('https://example.com/docs', source), external: true, surface: 'docs' }, quiet)

    expect(ours.findings.map(finding => finding.id)).toEqual(expect.arrayContaining(['T-15', 'U-12', 'U-15']))
    expect(theirs.findings.map(finding => finding.id)).not.toEqual(expect.arrayContaining(['T-15', 'U-12', 'U-15']))
  })

  it('leaves rhythm alone on the surfaces an agent reads', () => {
    const closer = 'Run the scanner before you judge anything. That is the rule.'
    const source = Array.from({ length: 8 }, () => closer).join('\n\n')

    const forAReader = evaluate(page('apps/docs/content/2.learn/a.md', source), quiet)
    const forAnAgent = evaluate(page('.agents/skills/create-adapter/SKILL.md', source), quiet)

    expect(forAReader.findings.map(finding => finding.id)).toContain('T-03')
    expect(forAnAgent.findings).toEqual([])
  })

  it('judges a rhythm against the corpus, not against a fixed number', () => {
    const closer = 'The pipeline batches every event before it leaves the process. That is the whole idea.'
    const source = Array.from({ length: 7 }, () => closer).join('\n\n')
    const strict = evaluate(page('apps/docs/content/2.learn/a.md', source), quiet)
    const houseRhythm = evaluate(page('apps/docs/content/2.learn/a.md', source), { sample: 20, epigramRatio: 0.9 })

    expect(strict.findings.map(finding => finding.id)).toContain('T-03')
    expect(houseRhythm.findings.map(finding => finding.id)).not.toContain('T-03')
  })
})
