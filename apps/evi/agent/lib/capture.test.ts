import { describe, expect, it, vi } from 'vitest'
import { browserContext, browserSandbox, captureAttestation, captureFrame, SCREENSHOT_DIR, CAPTURE_MARK, captureMarkdown, describeTarget, escapeInline, markdownUrl, readTargetProbe, resolveTargetExpression, sensitiveCaptureReason, unresolvedTargetMessage, validateCaptureUrl } from './capture'

describe('validateCaptureUrl', () => {
  it('accepts evlog surfaces, previews, and local dev servers', () => {
    expect(validateCaptureUrl('https://evlog.dev')).toBeNull()
    expect(validateCaptureUrl('https://www.evlog.dev/docs')).toBeNull()
    expect(validateCaptureUrl('https://evlog.cloud')).toBeNull()
    expect(validateCaptureUrl('https://evi-abc123-hrcd.vercel.app')).toBeNull()
    expect(validateCaptureUrl('http://localhost:3000/docs')).toBeNull()
    expect(validateCaptureUrl('http://127.0.0.1:4000')).toBeNull()
  })

  it('refuses foreign origins, raw IPs, and non-http schemes', () => {
    expect(validateCaptureUrl('https://example.com')).toMatch(/outside the allowed/)
    expect(validateCaptureUrl('http://169.254.169.254/latest')).toMatch(/outside the allowed/)
    expect(validateCaptureUrl('https://vercel.app')).toMatch(/outside the allowed/)
    expect(validateCaptureUrl('file:///etc/passwd')).toMatch(/must use http/)
    expect(validateCaptureUrl('not a url')).toMatch(/not a valid absolute URL/)
  })
})

describe('sensitiveCaptureReason', () => {
  it('flags the hosted product and telemetry hosts', () => {
    expect(sensitiveCaptureReason('https://evlog.cloud/dashboard')).toMatch(/hosted product/)
    expect(sensitiveCaptureReason('https://app.evlog.cloud')).toMatch(/hosted product/)
    expect(sensitiveCaptureReason('https://evlog-telemetry-abc-hrcd.vercel.app')).toMatch(/telemetry/)
    expect(sensitiveCaptureReason('http://localhost:4000/telemetry-playground')).toBeNull()
    expect(sensitiveCaptureReason('https://evlog.dev/docs')).toBeNull()
  })
})

describe('escaping', () => {
  it('collapses line breaks and escapes html and table characters', () => {
    expect(escapeInline('a  \n b | <img src=x onerror=1> & c')).toBe('a b \\| &lt;img src=x onerror=1&gt; &amp; c')
  })

  it('neutralizes parentheses in embedded urls', () => {
    expect(markdownUrl('https://evlog.dev/a(b)c')).toBe('https://evlog.dev/a%28b%29c')
  })

  it('keeps a forged caption from adding markdown structure', () => {
    const markdown = captureMarkdown({
      beforeUrl: 'https://evlog.dev',
      afterUrl: 'http://localhost:3000',
      beforeImageUrl: 'https://blob/x.png',
      afterImageUrl: 'https://blob/y.png',
      caption: 'ok\n\n## Forged section\n<script>x</script>',
      frame: 'full viewport',
      viewport: 'desktop',
      capturedAt: 't',
    })
    expect(markdown).not.toContain('\n## Forged')
    expect(markdown).not.toContain('<script>')
  })
})

describe('captureMarkdown', () => {
  it('renders the table, caption, and attestation receipt', () => {
    const markdown = captureMarkdown({
      beforeUrl: 'https://evlog.dev',
      afterUrl: 'http://localhost:3000',
      beforeImageUrl: 'https://blob/x.png',
      afterImageUrl: 'https://blob/y.png',
      caption: 'Landing hero, desktop viewport.',
      frame: '.hero',
      viewport: 'desktop',
      capturedAt: '2026-08-09T15:00:00.000Z',
    })
    expect(markdown).toContain('| ![before](https://blob/x.png) | ![after](https://blob/y.png) |')
    expect(markdown).toContain('Landing hero, desktop viewport.')
    expect(markdown).toContain('<sub>captured by agent-browser · https://evlog.dev/ → http://localhost:3000/ · desktop · .hero · 2026-08-09T15:00:00.000Z</sub>')
  })

  it('labels a selector-less capture as full viewport', () => {
    expect(
      captureAttestation({
        beforeUrl: 'https://evlog.dev/',
        afterUrl: 'https://evlog.cloud/',
        frame: 'full viewport',
        viewport: 'mobile',
        capturedAt: 't',
      }),
    ).toBe('captured by agent-browser · https://evlog.dev/ → https://evlog.cloud/ · mobile · full viewport · t')
  })
})


/** Evaluates a resolver expression against a stubbed page. */
function runInPage(expression: string, page: { document: unknown, window: unknown }): unknown {
  return new Function('document', 'window', `return ${expression}`)(page.document, page.window)
}

function element(text: string, section?: Record<string, unknown>) {
  const marks: Record<string, string> = {}
  return {
    textContent: text,
    marks,
    setAttribute: (name: string, value: string) => {
      marks[name] = value 
    },
    removeAttribute: (name: string) => {
      delete marks[name] 
    },
    closest: () => section ?? null,
  }
}

function pageWith(options: {
  bySelector?: Record<string, unknown> | null
  nodes?: Record<string, unknown>[]
  hooks?: string[]
  headings?: string[]
}) {
  const { bySelector = null, nodes = [], hooks = [], headings = [] } = options
  return {
    document: {
      querySelector: () => bySelector,
      querySelectorAll: (query: string) => {
        if (query.includes(CAPTURE_MARK)) return []
        if (query === '[data-section]') return hooks.map(hook => ({ getAttribute: () => hook }))
        if (query === 'h1, h2') return headings.map(heading => ({ textContent: heading }))
        return nodes
      },
    },
    window: {},
  }
}

describe('resolveTargetExpression', () => {
  it('marks the element the selector matched', () => {
    const target = element('anything')
    const probe = runInPage(resolveTargetExpression({ selector: '[data-section="landing-faq"]' }), pageWith({ bySelector: target }))
    expect(probe).toMatchObject({ found: true, how: 'selector' })
    expect(target.marks[CAPTURE_MARK]).toBe('')
  })

  it('falls back to the visible copy and widens it to the section', () => {
    const section = element('the whole section')
    const heading = element('Before you install', section)
    const probe = runInPage(resolveTargetExpression({ text: 'before you INSTALL' }), pageWith({ nodes: [element('unrelated'), heading] }))
    expect(probe).toMatchObject({ found: true, how: 'text' })
    expect(section.marks[CAPTURE_MARK]).toBe('')
    expect(heading.marks[CAPTURE_MARK]).toBeUndefined()
  })

  it('prefers the selector and keeps text as the fallback', () => {
    const target = element('matched by selector')
    const heading = element('Before you install')
    const probe = runInPage(
      resolveTargetExpression({ selector: '#faq', text: 'Before you install' }),
      pageWith({ bySelector: target, nodes: [heading] }),
    )
    expect(probe).toMatchObject({ found: true, how: 'selector' })
    expect(heading.marks[CAPTURE_MARK]).toBeUndefined()
  })

  it('marks the text match itself when it has no sectioning ancestor', () => {
    const orphan = element('Before you install')
    runInPage(resolveTargetExpression({ text: 'Before you install' }), pageWith({ nodes: [orphan] }))
    expect(orphan.marks[CAPTURE_MARK]).toBe('')
  })

  it('reports the page hooks and headings when nothing resolves', () => {
    const probe = runInPage(
      resolveTargetExpression({ selector: '.missing', text: 'absent copy' }),
      pageWith({ nodes: [element('something else')], hooks: ['landing-hero', 'landing-hero'], headings: ['One command'] }),
    )
    expect(probe).toEqual({ found: false, how: null, hooks: ['landing-hero'], headings: ['One command'] })
  })

  it('embeds selector and text as literals, so a quote cannot break out', () => {
    const expression = resolveTargetExpression({ selector: '[data-x="a\'b\\"c"]', text: '") + alert(1) + ("' })
    expect(() => runInPage(expression, pageWith({}))).not.toThrow()
  })
})

describe('readTargetProbe', () => {
  it('reads the agent-browser envelope', () => {
    expect(readTargetProbe({ data: { found: true, how: 'text', hooks: [], headings: [] } })).toEqual({
      found: true,
      how: 'text',
      hooks: [],
      headings: [],
    })
  })

  it('treats a malformed probe as unresolved rather than as a frame', () => {
    expect(readTargetProbe({ data: {} })).toEqual({ found: false, how: null, hooks: [], headings: [] })
    expect(() => readTargetProbe({ data: null })).toThrow(/no target probe/)
    expect(() => readTargetProbe(null)).toThrow(/no target probe/)
  })
})

describe('describeTarget', () => {
  it('records how the frame was located', () => {
    expect(describeTarget({ selector: '[data-section="landing-faq"]' }, 'selector')).toBe('[data-section="landing-faq"]')
    expect(describeTarget({ text: 'Before you install' }, 'text')).toBe('text "Before you install"')
    expect(describeTarget({}, null)).toBe('full viewport')
  })
})

describe('unresolvedTargetMessage', () => {
  it('names what was asked for and what the page offers', () => {
    const message = unresolvedTargetMessage(
      { selector: '.py-24', text: 'Before you install' },
      { found: false, how: null, hooks: ['landing-hero'], headings: ['One command'] },
    )
    expect(message).toContain('selector ".py-24" nor text "Before you install"')
    expect(message).toContain('[data-section="landing-hero"]')
    expect(message).toContain('"One command"')
  })

  it('says so when the page offers neither', () => {
    expect(
      unresolvedTargetMessage({ selector: '.py-24' }, { found: false, how: null, hooks: [], headings: [] }),
    ).toMatch(/no hooks and no headings/)
  })
})

describe('browserSandbox', () => {
  it('names the session and forwards commands to the eve sandbox', async () => {
    const run = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: 'ok', stderr: '' }))
    const session = browserSandbox({ run }, 'sess_1')
    expect(session.id).toBe('sess_1')
    await expect(session.run({ command: 'true' })).resolves.toMatchObject({ exitCode: 0 })
    expect(run).toHaveBeenCalledWith({ command: 'true' })
  })

  it('hands agent-browser the same session on every lookup', async () => {
    const run = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }))
    const ctx = browserContext({ run }, 'sess_1')
    const first = await ctx.getSandbox()
    expect(await ctx.getSandbox()).toBe(first)
    expect(first).toMatchObject({ id: 'sess_1' })
  })
})

describe('captureFrame', () => {
  function fakeRun(evalPayload: unknown) {
    return vi.fn(async ({ command }: { command: string }) => ({
      exitCode: 0,
      stdout: /\beval\b/.test(command) ? JSON.stringify(evalPayload) : '',
      stderr: '',
    }))
  }

  it('drives the browser through viewport, open, settle, probe, scroll, and screenshot', async () => {
    const run = fakeRun({ data: { found: true, how: 'selector', hooks: [], headings: [] } })
    const frame = await captureFrame(browserContext({ run }, 'sess_1'), {
      side: 'before',
      target: { selector: '.hero' },
      url: 'http://localhost:3000',
      viewport: 'desktop',
    })

    expect(frame.how).toBe('selector')
    expect(frame.path).toMatch(/^\/workspace\/screenshots\/before-\d+\.png$/)

    const commands = run.mock.calls.map(([arg]) => arg.command)
    expect(commands[0]).toContain('set viewport 1280 800')
    expect(commands[1]).toContain('open http://localhost:3000')
    expect(commands[2]).toContain('wait 5000')
    expect(commands.some(c => /\beval\b/.test(c))).toBe(true)
    expect(commands.at(-3)).toContain('scrollintoview')
    expect(commands.at(-3)).toContain(`[${CAPTURE_MARK}]`)
    expect(commands.at(-1)).toContain(`screenshot ${frame.path}`)
  })

  it('captures the full viewport when no target is given', async () => {
    const run = fakeRun({ data: { found: false, how: null, hooks: [], headings: [] } })
    const frame = await captureFrame(browserContext({ run }, 'sess_1'), {
      side: 'after',
      target: null,
      url: 'https://evlog.dev',
      viewport: 'mobile',
    })

    expect(frame.how).toBeNull()
    const commands = run.mock.calls.map(([arg]) => arg.command)
    expect(commands[0]).toContain('set viewport 375 812')
    expect(commands.some(c => /\beval\b/.test(c))).toBe(false)
    expect(commands.at(-1)).toContain(`screenshot ${frame.path}`)
  })

  it('rejects with the page hooks and headings when the target matches nothing', async () => {
    const run = fakeRun({ data: { found: false, how: null, hooks: ['landing-faq'], headings: ['FAQ'] } })
    await expect(captureFrame(browserContext({ run }, 'sess_1'), {
      side: 'before',
      target: { text: 'missing copy' },
      url: 'https://evlog.dev',
      viewport: 'desktop',
    })).rejects.toMatchObject({ code: 'evi.CAPTURE_TARGET_UNRESOLVED' })
  })

  it('frames land in SCREENSHOT_DIR', () => {
    expect(SCREENSHOT_DIR).toBe('/workspace/screenshots')
  })
})
