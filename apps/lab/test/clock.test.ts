import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClock } from '../app/utils/lab/clock'

class StageElement {
  constructor(private readonly speed: string | undefined) {}

  closest(selector: string) {
    if (selector === '[data-lab-stage]') return this
    if (selector === '[data-stage-speed]') return { dataset: { stageSpeed: this.speed } }
    return null
  }
}

function clockWithStageSpeed(speed: string | undefined) {
  const animation = {
    currentTime: null,
    effect: { target: new StageElement(speed) },
    pause: vi.fn(),
    play: vi.fn(),
  }

  vi.stubGlobal('Element', StageElement)
  vi.stubGlobal('document', { getAnimations: () => [animation] })
  vi.stubGlobal('performance', { now: () => 0 })
  vi.stubGlobal('window', {
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    setTimeout: vi.fn(),
  })
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null as null | (() => void) }
    port2 = { postMessage: () => this.port1.onmessage?.() }
  })

  return { animation, clock: createClock() }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('virtual animation clock', () => {
  it.each([undefined, '', 'invalid', '0', '-2'])('uses normal playback for an invalid stage speed of %s', (speed) => {
    const { animation, clock } = clockWithStageSpeed(speed)

    clock.enterVirtual()
    clock.advanceSync(100)

    expect(animation.currentTime).toBe(100)
    clock.dispose()
  })

  it('applies a valid stage speed', () => {
    const { animation, clock } = clockWithStageSpeed('2')

    clock.enterVirtual()
    clock.advanceSync(100)

    expect(animation.currentTime).toBe(200)
    clock.dispose()
  })
})
