import { t, language } from '../../shared/i18n'
import type { SpeechModelOption, SpeechModels } from '../../shared/types'

/** a model's download size in GB, as Settings shows it */
export const speechSize = (bytes: number) => new Intl.NumberFormat(language(), { maximumFractionDigits: 2 }).format(bytes / 1e9)

/** how much later than the meeting an hour-long meeting's transcript finishes with this model, in minutes */
export const minutesBehind = (rtf: number) => Math.max(1, Math.round((rtf - 1) * 60))

/** a model that would fall behind or never finish on this computer: picking it takes a second, clearly worded step */
export const speechRisky = (m: SpeechModelOption) => m.pace === 'behind' || m.pace === 'too-slow'

/**
 * What picking this model means on this computer, in plain words: accuracy against speed, from how it did in the speed
 * check, and the cost to the computer when it can't keep up. Most accurate first in view.models, so a model after the
 * recommended one is less accurate (and faster: smaller ones aren't timed).
 */
export function speechAdvice(m: SpeechModelOption, view: SpeechModels): string[] {
  if (m.needsGraphics) return [t("Needs a graphics card. This computer's processor would take several times the meeting's length.")]
  if (m.recommended) return [t('The most accurate model that keeps up with a live meeting on this computer.')]
  const at = view.models.indexOf(m), recommended = view.models.findIndex((x) => x.recommended)
  if ((recommended >= 0 && at > recommended) || m.pace === 'untimed') return [t('Faster and lighter, but less accurate, especially with names, accents and languages other than English.')]
  const strain = t('While it catches up, your computer works harder: fans, heat and battery, and other apps can slow down.')
  switch (m.pace) {
    case 'live': return [t('The most accurate model that keeps up with a live meeting on this computer.')]
    case 'close': return [t('Close to the limit on this computer: live words can lag a little behind.')]
    case 'behind': return [t("Falls behind on this computer: it took {rtf}× the audio's length in the speed check. An hour-long meeting's transcript would finish about {minutes} min after it ends.", {
      rtf: new Intl.NumberFormat(language(), { maximumFractionDigits: 1 }).format(m.rtf ?? 0), minutes: minutesBehind(m.rtf ?? 1) }), strain]
    default: return [t('Too slow for this computer: a transcript can take hours, or not finish.'), strain]
  }
}
