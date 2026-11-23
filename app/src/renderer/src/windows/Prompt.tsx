import { useEffect, useState } from 'react'
import { X } from '../components/Icons'
import type { PromptView } from '../../../shared/types'
import { SPOKEN, type Spoken } from '../../../shared/spoken'
import { spokenChoiceName } from '../components/SpokenMenu'
import { t } from '../../../shared/i18n'
import { AppIcon } from '../components/Logo'

/** The small card that offers to take notes when a call starts, and asks whether to stop when it ends. */
export function Prompt() {
  const [view, setView] = useState<PromptView | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [countdown, setCountdown] = useState(0)
  // the language the meeting will be heard in, changed right here before it starts
  const [spoken, setSpoken] = useState<Spoken>()
  useEffect(() => { void window.yogurt.prompt.state().then(setView) }, [])
  useEffect(() => { void window.yogurt.settings.get().then(p => setSpoken(p.spoken)).catch(() => {}) }, [])
  const nextSpoken = () => {
    if (!spoken) return
    const v = SPOKEN[(SPOKEN.indexOf(spoken) + 1) % SPOKEN.length]
    setSpoken(v)
    void window.yogurt.settings.setSpoken(v).catch(() => {})
  }
  useEffect(() => {
    if (view?.kind !== 'start' || hovered || focused) return
    // The bar and dismissal both restart after the person finishes interacting.
    setCountdown(cycle => cycle + 1)
    const timer = setTimeout(() => window.yogurt.prompt.act('close'), 12_000)
    return () => clearTimeout(timer)
  }, [view, hovered, focused])
  if (!view) return <div className="h-full bg-bg" />

  const start = view.kind === 'start'
  const name = start && view.app ? t('{app} call', { app: view.app }) : view.title || t('Meeting')
  return (
    <div data-testid="prompt" data-kind={view.kind} data-paused={hovered || focused} className="call-prompt"
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false) }}>
      {start && <span key={countdown} data-testid="prompt-countdown" className="call-prompt-countdown" aria-hidden="true" />}
      <div className="call-prompt-heading">
        <AppIcon className="call-prompt-icon" />
        <div className="min-w-0 flex-1">
          <p data-testid="prompt-heading" className="call-prompt-label">{start ? t('Take notes?') : t('Stop recording?')}</p>
          <p data-testid="prompt-title" className="call-prompt-title" title={view.title || name}>{name}
            {start && spoken && <> · <button data-testid="prompt-spoken" className="call-prompt-spoken" onClick={nextSpoken}
              title={t('Spoken language')} aria-label={t('Spoken language: {language}. Change', { language: spokenChoiceName(spoken) })}>{spokenChoiceName(spoken)}</button></>}
          </p>
        </div>
      </div>
      <div className="call-prompt-actions">
        {start ? (
          <button data-testid="prompt-take-notes" className="workspace-button" onClick={() => window.yogurt.prompt.act('take-notes')}>
            {t('Start recording')}
          </button>
        ) : (
          <>
            <button data-testid="prompt-keep-going" className="workspace-button" onClick={() => window.yogurt.prompt.act('keep-going')}>
              {t('Keep going')}
            </button>
            <button data-testid="prompt-stop" className="workspace-button primary" onClick={() => window.yogurt.prompt.act('stop')}>
              {t('Stop')}
            </button>
          </>
        )}
      </div>
      <button data-testid={start ? 'prompt-close' : 'prompt-dismiss-stop'} aria-label={t(start ? 'Not now' : 'Close')} title={start ? undefined : t('Close')} className="ghost-btn workspace-icon" onClick={() => window.yogurt.prompt.act('close')}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
