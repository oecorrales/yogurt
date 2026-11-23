import { KEEPS_UP_RTF, type Catalog, type Hardware } from '@yogurt/picker'
import type { SpeechModels, SpeechPace } from '../../shared/types'
import type { SpeedResult } from '../setup'

/** past this, a meeting's transcript takes hours or never finishes: shown as too slow, never as a wait */
export const TOO_SLOW_RTF = 3

/**
 * How a model did in the speed check. The check reads one track; a meeting is two, each talking about half the time,
 * so whisper reads about as much audio as the meeting lasts: up to KEEPS_UP_RTF it keeps up with room to spare, up to
 * 1 it can lag a little live but is done when the meeting is, and past that the transcript ends (rtf - 1) times the
 * meeting's length after it.
 */
export function speechPace(rtf: number | null | undefined): SpeechPace {
  if (rtf === undefined) return 'untimed'
  if (rtf === null || rtf > TOO_SLOW_RTF) return 'too-slow'
  if (rtf <= KEEPS_UP_RTF) return 'live'
  return rtf <= 1 ? 'close' : 'behind'
}

/**
 * Settings' view of the speech models on Windows and Linux: the ones this computer can use, most accurate first, with
 * how each did in the speed check. The last-resort ones (base, tiny) only when one is in use. A model that needs a
 * graphics card is listed on a computer without one, so the person sees why it isn't offered.
 */
export function speechModels(o: { hw: Hardware; catalog: Catalog; result: SpeedResult; current: string }): SpeechModels {
  const noGraphics = o.hw.gpu.kind === 'none'
  const models = o.catalog.asr
    .filter((a) => a.minMemGB <= o.hw.totalRamGB && (!a.lastResort || a.id === o.current))
    .map((a) => {
      const rtf = a.id in o.result.rtf ? o.result.rtf[a.id] : undefined
      const needsGraphics = noGraphics && !!a.gpuOnly
      return { id: a.id, name: a.name, bytes: a.bytes, ...(rtf !== undefined ? { rtf } : {}), pace: needsGraphics ? 'too-slow' as const : speechPace(rtf),
        recommended: a.id === o.result.model, ...(needsGraphics ? { needsGraphics } : {}) }
    })
  return {
    current: o.current,
    chosenBy: o.result.chosen && o.result.chosen === o.current && o.current !== o.result.model ? 'you' : 'check',
    graphics: !noGraphics && !o.result.gpuOff,
    models,
    ...(o.result.model === null ? { noneKeepsUp: true } : {}),
  }
}
