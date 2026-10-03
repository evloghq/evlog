import type { Layer, LayerShot } from './layers'
import type { LayerEffect } from './effects'
import type { LabSettings, ShotSettingKey } from './settings'

export interface ResolvedShot {
  settings: LabSettings
  camera: LayerEffect[]
  cameraTime: number
  cameraDuration: number
  layerId: string | null
}

export function hasLayerShot(layer: Layer): boolean {
  return Boolean(layer.shot?.camera !== undefined || Object.keys(layer.shot?.settings ?? {}).length)
}

export function resolveLayerShotSettings(settings: LabSettings, layer: Layer | null): LabSettings {
  return layer?.shot?.settings ? { ...settings, ...layer.shot.settings } : settings
}

/** Remove one clip override so that setting inherits from the timeline again. */
export function withoutLayerShotSetting(layer: Layer, key: ShotSettingKey): LayerShot | undefined {
  const settings = { ...layer.shot?.settings }
  delete settings[key]
  const camera = layer.shot?.camera
  if (!Object.keys(settings).length && camera === undefined) return undefined

  return {
    ...(Object.keys(settings).length ? { settings } : {}),
    ...(camera !== undefined ? { camera } : {}),
  }
}

/** Topmost visible clip with an authored shot at this point on the timeline. */
export function shotLayerAt(layers: Layer[], time: number): Layer | null {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index]
    if (!layer || layer.hidden || !hasLayerShot(layer)) continue
    if (time >= layer.start && time <= layer.start + layer.duration) return layer
  }
  return null
}

export function resolveTimelineShot(
  settings: LabSettings,
  camera: LayerEffect[],
  layers: Layer[],
  time: number,
): ResolvedShot {
  const layer = shotLayerAt(layers, time)
  const localCamera = layer?.shot?.camera
  return {
    settings: resolveLayerShotSettings(settings, layer),
    camera: localCamera ?? camera,
    cameraTime: localCamera ? time - layer.start : time,
    cameraDuration: localCamera ? layer.duration : settings.timelineLength,
    layerId: layer?.id ?? null,
  }
}
