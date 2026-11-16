import { WriteStream } from 'node:tty'
import { describe, expect, it } from 'vitest'
import { createContext } from '../src/core/context'

/* A terminal that answers the way Node's own does for the environment it is given. */
const terminal = { isTTY: true, columns: 120, getColorDepth: WriteStream.prototype.getColorDepth }
const file = { isTTY: false }

function colors(stream: typeof terminal | typeof file, env: Record<string, string>): { color: boolean, truecolor: boolean } {
  const { color, truecolor } = createContext({ cwd: '/tmp', env }, stream)
  return { color, truecolor }
}

describe('colors of the stream a command writes to', () => {
  it('are off for a file, whatever the terminal around it', () => {
    expect(colors(file, { TERM: 'xterm-256color', COLORTERM: 'truecolor' })).toEqual({ color: false, truecolor: false })
  })

  it('are on for a terminal, in truecolor only when it says so', () => {
    expect(colors(terminal, { TERM: 'xterm-256color' })).toEqual({ color: true, truecolor: false })
    expect(colors(terminal, { TERM: 'xterm-256color', COLORTERM: 'truecolor' })).toEqual({ color: true, truecolor: true })
  })

  it.each([
    ['TERM=dumb', { TERM: 'dumb', COLORTERM: 'truecolor' }],
    ['FORCE_COLOR=0', { TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '0' }],
    ['NO_COLOR', { TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1' }],
    ['NO_COLOR next to FORCE_COLOR', { TERM: 'xterm-256color', NO_COLOR: '1', FORCE_COLOR: '3' }],
  ])('are off for a terminal under %s', (_, env) => {
    expect(colors(terminal, env)).toEqual({ color: false, truecolor: false })
  })

  it('are forced onto a file by FORCE_COLOR, at the level it names', () => {
    expect(colors(file, { FORCE_COLOR: '1' })).toEqual({ color: true, truecolor: false })
    expect(colors(file, { FORCE_COLOR: '3' })).toEqual({ color: true, truecolor: true })
    expect(colors(file, { FORCE_COLOR: '0' })).toEqual({ color: false, truecolor: false })
    expect(colors(file, { FORCE_COLOR: '1', NO_COLOR: '1' })).toEqual({ color: false, truecolor: false })
  })
})
