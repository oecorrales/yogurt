/**
 * The language people speak in meetings, picked in the note's footer or Settings → Language. English only (the default)
 * or Spanish only tells whisper and Apple's speech which it is, so nothing is guessed; Multi-language leaves whisper to
 * hear which it is. Not the interface's language, and not the one the notes are written in.
 */
export type Spoken = 'en' | 'es' | 'multi'
export const SPOKEN: readonly Spoken[] = ['en', 'es', 'multi']
/** the languages that can be picked as the only one spoken, by their code */
export type OneLanguage = Exclude<Spoken, 'multi'>
export const spokenOf = (v: unknown): Spoken => (SPOKEN.includes(v as Spoken) ? v as Spoken : 'en')
/** what whisper is told for each chunk: the one language picked, or nothing (it detects, then keeps each track's language) */
export const whisperLanguage = (s: Spoken): OneLanguage | undefined => (s === 'multi' ? undefined : s)
/** how many languages whisper can hear (whisper.cpp's g_lang list less Cantonese, which large-v3 added) */
export const WHISPER_LANGUAGES = 99
