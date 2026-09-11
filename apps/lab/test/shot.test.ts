import { describe, expect, it } from 'vitest'
import {
  canChangeLayerSpeed,
  canJoin,
  createComponentLayer,
  createMediaLayer,
  layerDurationForSourceEnd,
  layerOrigin,
  layerSpeed,
  layerSourceTimeAt,
  sanitizeLayers,
  withLayerSpeed,
} from '../app/utils/lab/layers'
import { sequenceAtSpeed } from '../app/utils/lab/sequence'
import { DEFAULT_SETTINGS, sanitizeShotSettings, settingsFromQuery } from '../app/utils/lab/settings'
import { resolveLayerShotSettings, resolveTimelineShot, shotLayerAt, withoutLayerShotSetting } from '../app/utils/lab/shot'

function video(start = 0, duration = 2000) {
  return createMediaLayer({ kind: 'video', start, duration, src: 'asset:video', name: 'Video' })
}

describe('clip shots', () => {
  it('inherits timeline values until a clip overrides them', () => {
    const layer = { ...video(), shot: { settings: { exposure: 1.8 } } }
    const resolved = resolveLayerShotSettings(DEFAULT_SETTINGS, layer)

    expect(resolved.exposure).toBe(1.8)
    expect(resolved.zoom).toBe(DEFAULT_SETTINGS.zoom)
    expect(DEFAULT_SETTINGS.exposure).toBe(1)
  })

  it('uses the topmost active custom shot and local camera time', () => {
    const lower = { ...video(), id: 'lower', shot: { settings: { exposure: 1.4 } } }
    const upper = {
      ...video(500, 1000),
      id: 'upper',
      shot: {
        settings: { exposure: 2 },
        camera: [{ kind: 'fade' as const, at: 'in' as const, duration: 200, easing: 'out' as const, amount: 0 }],
      },
    }

    expect(shotLayerAt([lower, upper], 700)?.id).toBe('upper')
    expect(resolveTimelineShot(DEFAULT_SETTINGS, [], [lower, upper], 700)).toMatchObject({
      layerId: 'upper',
      cameraTime: 200,
      cameraDuration: 1000,
      settings: { exposure: 2 },
    })
  })

  it('ignores hidden and inactive clip shots', () => {
    const hidden = { ...video(), hidden: true, shot: { settings: { zoom: 2 } } }
    const future = { ...video(3000), shot: { settings: { zoom: 3 } } }

    expect(shotLayerAt([hidden, future], 1000)).toBeNull()
  })

  it('keeps timeline camera moves when a clip only overrides visual settings', () => {
    const camera = [{ kind: 'dolly' as const, at: 'in' as const, duration: 400, easing: 'out' as const, amount: 1 }]
    const layer = { ...video(), shot: { settings: { exposure: 1.4 } } }

    expect(resolveTimelineShot(DEFAULT_SETTINGS, camera, [layer], 500)).toMatchObject({
      camera,
      cameraTime: 500,
      cameraDuration: DEFAULT_SETTINGS.timelineLength,
    })
  })

  it('sanitizes persisted shot values', () => {
    const [layer] = sanitizeLayers([
      {
        ...video(),
        shot: { settings: { zoom: 99, stylize: 'unknown', tonemap: false } },
      },
    ])

    expect(layer?.shot?.settings).toEqual({ zoom: 4, tonemap: false })
  })

  it('coerces query and persisted shot settings consistently', () => {
    expect(settingsFromQuery({ zoom: '99', stylize: 'unknown', tonemap: 'false' })).toMatchObject({
      zoom: 4,
      stylize: DEFAULT_SETTINGS.stylize,
      tonemap: false,
    })
    expect(sanitizeShotSettings({ zoom: 99, stylize: 'unknown', tonemap: false })).toEqual({
      zoom: 4,
      tonemap: false,
    })
  })

  it('ignores malformed persisted camera overrides', () => {
    const camera = [{ kind: 'dolly' as const, at: 'in' as const, duration: 400, easing: 'out' as const, amount: 1 }]
    const [layer] = sanitizeLayers([
      {
        ...video(),
        shot: { settings: { exposure: 1.4 }, camera: 'invalid' },
      },
    ])

    expect(layer?.shot).toEqual({ settings: { exposure: 1.4 } })
    expect(resolveTimelineShot(DEFAULT_SETTINGS, camera, [layer!], 500).camera).toBe(camera)
  })

  it('returns one setting to timeline inheritance without dropping other overrides', () => {
    const camera = [{ kind: 'dolly' as const, at: 'in' as const, duration: 400, easing: 'out' as const, amount: 1 }]
    const layer = {
      ...video(),
      shot: { settings: { focus: 0.8, exposure: 1.4 }, camera },
    }

    expect(withoutLayerShotSetting(layer, 'focus')).toEqual({ settings: { exposure: 1.4 }, camera })
    expect(withoutLayerShotSetting({ ...video(), shot: { settings: { focus: 0.8 } } }, 'focus')).toBeUndefined()
  })
})

describe('clip speed', () => {
  it('shortens the timeline span without changing the source out-point', () => {
    const layer = { ...video(1000, 2000), trim: 500 }
    const faster = withLayerSpeed(layer, 2)

    expect(faster).toMatchObject({ duration: 1000, speed: 2 })
    expect(layerSourceTimeAt(faster, 2000)).toBe(2500)
    expect(layerSourceTimeAt(layer, 3000)).toBe(2500)
  })

  it('limits playback rate to time-based clips and the supported range', () => {
    const image = createMediaLayer({ kind: 'image', start: 0, duration: 2000, src: 'asset:image', name: 'Image' })

    expect(canChangeLayerSpeed(image)).toBe(false)
    expect(withLayerSpeed(image, 2)).toBe(image)
    expect(withLayerSpeed(video(), 99)).toMatchObject({ speed: 4, duration: 500 })
    expect(withLayerSpeed(video(), 0.01)).toMatchObject({ speed: 0.25, duration: 8000 })
  })

  it('keeps split clips joinable at the same playback rate', () => {
    const head = { ...video(0, 1000), speed: 2, trim: 500 }
    const tail = { ...video(1000, 500), speed: 2, trim: 2500 }

    expect(canJoin(head, tail)).toBe(true)
    expect(canJoin(head, { ...tail, speed: 1 })).toBe(false)
    expect(canJoin(head, { ...tail, shot: { settings: { exposure: 2 } } })).toBe(false)
  })

  it('speeds up staged component clips and preserves their trimmed source point', () => {
    const layer = { ...createComponentLayer('Demo', 1000, 2000), trim: 500 }
    const faster = withLayerSpeed(layer, 2)

    expect(faster).toMatchObject({ duration: 1000, speed: 2 })
    expect(layerSpeed(faster)).toBe(2)
    expect(layerOrigin(faster)).toBe(750)
  })

  it('fits a retimed component from its trimmed source point', () => {
    const layer = { ...createComponentLayer('Demo', 0, 1500), trim: 500, speed: 2 }

    expect(layerDurationForSourceEnd(layer, 2000)).toBe(750)
  })

  it('scales component sequence events and their reported duration', () => {
    expect(sequenceAtSpeed([{ at: 250 }, { at: 1000 }], 2000, 2)).toEqual({
      events: [{ at: 125 }, { at: 500 }],
      totalDuration: 1000,
    })
  })
})
