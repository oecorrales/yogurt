import { useEffect, useState } from 'react'
import { ChevronDown } from './Icons'
import { t } from '../../../shared/i18n'
import type { SetupState } from '../../../shared/types'
import { speechAdvice, speechRisky, speechSize } from '../speechModel'

/**
 * Settings → Transcription model (Windows and Linux): which speech model runs and why, the others this computer can
 * use with what each costs, and the speed check again. A model that would fall behind takes a second, clearly worded
 * step, so nobody picks the bigger one only because it is there.
 */
export function SpeechModelSetting() {
  const [setup, setSetup] = useState<SetupState>()
  const [pick, setPick] = useState<string>()
  const [problem, setProblem] = useState<'busy' | 'failed'>()
  useEffect(() => {
    let current = false, active = true
    const off = window.yogurt.setup.onState(state => { current = true; setSetup(state) })
    void window.yogurt.setup.state().then(state => { if (active && !current) setSetup(state) })
    return () => { active = false; off() }
  }, [])
  const view = setup?.speech
  if (!view) return null
  const now = view.models.find(m => m.id === view.current)
  const chosen = pick && pick !== view.current ? view.models.find(m => m.id === pick) : undefined
  const suggested = view.models.find(m => m.recommended)
  const busy = !!view.busy
  const run = async (action: () => Promise<'ok' | 'busy' | 'failed'>) => {
    setProblem(undefined)
    const r = await action()
    if (r === 'ok') setPick(undefined)
    else setProblem(r)
  }
  const status = view.busy === 'checking' ? t('Checking speed…')
    : view.busy === 'downloading' && chosen ? t('Downloading {name} · {percent}%', { name: chosen.name, percent: Math.floor((view.fraction ?? 0) * 100) })
    : view.noneKeepsUp ? t('The speed check found no model that keeps up on this computer, so Yogurt keeps using this one. Transcripts can finish well after meetings.')
    : view.chosenBy === 'you' && suggested ? t('You picked this model. The speed check suggests {name}.', { name: suggested.name })
    : t('Picked by the speed check: the most accurate model that keeps up with a meeting on this computer.')

  return <>
    <div className="settings-row" data-testid="settings-speech-model">
      <div className="settings-row-copy">
        <label htmlFor="settings-speech-model-pick" className="settings-label">{t('Transcription model')}</label>
        <p className="settings-description">{now?.name} · {view.graphics ? t('On your graphics card') : t('On the processor')}</p>
        <p className="settings-description" data-testid="settings-speech-model-status">{status}</p>
        <p className="settings-description">{t("Bigger models get more words right but need more from your computer. One that can't keep up makes transcripts finish late and keeps your computer busy, warm and on battery longer.")}</p>
      </div>
      <span className="settings-select-wrap">
        <select id="settings-speech-model-pick" data-testid="settings-speech-model-pick" className="settings-select" disabled={busy}
          value={pick ?? view.current} onChange={e => { setProblem(undefined); setPick(e.target.value) }}>
          {view.models.map(m => <option key={m.id} value={m.id} disabled={m.needsGraphics}>
            {m.recommended ? t('{name} · recommended', { name: m.name }) : m.name}
          </option>)}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </div>
    {chosen && <div className="settings-row" data-testid="settings-speech-model-choice">
      <div className="settings-row-copy">
        {speechAdvice(chosen, view).map(line => <p key={line} className="settings-description">{line}</p>)}
        <p className="settings-description">{t('The model you use now is removed after the new one is in place.')}</p>
      </div>
      <span className="flex flex-col gap-2">
        <button data-testid="settings-speech-model-use" className="workspace-button settings-action" disabled={busy || chosen.needsGraphics} aria-busy={view.busy === 'downloading'}
          onClick={() => void run(() => window.yogurt.setup.useSpeechModel(chosen.id))}>
          {speechRisky(chosen) ? t('Use {name} anyway ({size} GB download)', { name: chosen.name, size: speechSize(chosen.bytes) })
            : t('Use {name} ({size} GB download)', { name: chosen.name, size: speechSize(chosen.bytes) })}
        </button>
        <button className="workspace-button settings-action" disabled={busy} onClick={() => { setPick(undefined); setProblem(undefined) }}>{t('Cancel')}</button>
      </span>
    </div>}
    <div className="settings-row">
      <div className="settings-row-copy">
        <p className="settings-label">{t('Check speed again')}</p>
        <p className="settings-description">{t('Times each model on this computer, about a minute. Useful after a new graphics card or driver, or to go back to the suggested model.')}</p>
        {problem && <p role="alert" className="settings-description" data-testid="settings-speech-model-problem">
          {problem === 'busy' ? t('Available once no meeting is being recorded or transcribed.') : t("Yogurt couldn't change the transcription model.")}</p>}
      </div>
      <button data-testid="settings-speech-check" className="workspace-button settings-action" disabled={busy} aria-busy={view.busy === 'checking'}
        onClick={() => void run(() => window.yogurt.setup.checkSpeech())}>
        {view.busy === 'checking' ? t('Checking speed…') : t('Check speed again')}
      </button>
    </div>
  </>
}
