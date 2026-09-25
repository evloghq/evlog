/**
 * The docs sequencer, with the lab listening in.
 *
 * The staged components import it as `~/composables/useTimedSequence`, and `~`
 * resolves to whichever app is running them — so this app has to answer at that
 * path. That makes this file the seam: the docs app keeps one implementation and
 * knows nothing about the lab, while a component staged *here* also reports the
 * length it declared, so a clip can be cut to its animation instead of to a
 * guess. Running on the site, none of this exists.
 */

import { useTimedSequence as sequence } from '../../../docs/app/composables/useTimedSequence'
import type { UseTimedSequenceOptions } from '../../../docs/app/composables/useTimedSequence'
import { LAB_STAGE_LAYER, LAB_STAGE_SPEED, reportSequenceDuration, sequenceAtSpeed } from '~/utils/lab/sequence'

export type { TimedEvent, UseTimedSequenceOptions } from '../../../docs/app/composables/useTimedSequence'

export function useTimedSequence(options: UseTimedSequenceOptions) {
  // Absent outside a stage — the same component can be mounted with no clip
  // behind it, and then there is nothing to report to.
  const layerId = inject(LAB_STAGE_LAYER, null)
  const speed = inject(LAB_STAGE_SPEED, () => 1)()
  const timing = sequenceAtSpeed(options.events, options.totalDuration, speed)
  if (layerId) reportSequenceDuration(layerId, options.totalDuration)

  return sequence({ ...options, ...timing })
}
