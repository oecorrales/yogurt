import { describe, expect, it } from 'vitest'
import type { Catalog, Hardware } from '@yogurt/picker'
import bundled from '../../catalog/catalog.json'
import { speechModels, speechPace } from '../src/main/asr/speechModels'
import { minutesBehind, speechAdvice, speechRisky } from '../src/renderer/src/speechModel'
import type { SpeechModels } from '../src/shared/types'

const catalog = bundled as unknown as Catalog
const turbo = 'whisper-large-v3-turbo-q5_0', small = 'whisper-small-q5_1'
const gpuPc: Hardware = { os: 'win32', arch: 'x64', cpuModel: 'AMD Ryzen 5 5600X', totalRamGB: 16, freeDiskGB: 500, gpu: { kind: 'discrete', name: 'NVIDIA GeForce RTX 3060', vramGB: 12 }, cores: 12 }
const cpuPc: Hardware = { ...gpuPc, gpu: { kind: 'none', name: '', vramGB: 0 } }

describe('how a speech model did in the speed check', () => {
  it('keeps up, close, behind, too slow, or not timed', () => {
    expect(speechPace(0.02)).toBe('live')
    expect(speechPace(0.5)).toBe('live')
    expect(speechPace(0.8)).toBe('close')
    expect(speechPace(1.5)).toBe('behind')
    expect(speechPace(4)).toBe('too-slow')
    expect(speechPace(null)).toBe('too-slow')
    expect(speechPace(undefined)).toBe('untimed')
  })
})

describe("Settings' list of speech models", () => {
  it('most accurate first, the recommended one marked, last-resort ones hidden unless in use', () => {
    const v = speechModels({ hw: gpuPc, catalog, result: { key: 'k', model: turbo, rtf: { [turbo]: 0.02 }, at: 1 }, current: turbo })
    expect(v.models.map((m) => m.id)).toEqual([turbo, small])
    expect(v.models[0]).toMatchObject({ recommended: true, pace: 'live', rtf: 0.02 })
    expect(v.models[1]).toMatchObject({ recommended: false, pace: 'untimed' })
    const tiny = speechModels({ hw: cpuPc, catalog, result: { key: 'k', model: 'whisper-tiny-q5_1', rtf: {}, at: 1 }, current: 'whisper-tiny-q5_1' })
    expect(tiny.models.map((m) => m.id)).toContain('whisper-tiny-q5_1')
    expect(tiny.models.map((m) => m.id)).not.toContain('whisper-base-q5_1')
  })

  it('turbo needs graphics and 8 GB of memory', () => {
    const v = speechModels({ hw: cpuPc, catalog, result: { key: 'k', model: small, rtf: { [small]: 0.3 }, at: 1 }, current: small })
    expect(v.models[0]).toMatchObject({ id: turbo, needsGraphics: true })
    expect(v.graphics).toBe(false)
    const low = speechModels({ hw: { ...gpuPc, totalRamGB: 6 }, catalog, result: { key: 'k', model: small, rtf: {}, at: 1 }, current: small })
    expect(low.models.map((m) => m.id)).not.toContain(turbo)
  })

  it("the person's pick shows as theirs; whisper pushed off the graphics card shows as the processor", () => {
    const v = speechModels({ hw: gpuPc, catalog, result: { key: 'k', model: turbo, rtf: { [turbo]: 0.02 }, at: 1, chosen: small, gpuOff: true }, current: small })
    expect(v).toMatchObject({ chosenBy: 'you', graphics: false })
  })
})

describe('what picking a model means, in plain words', () => {
  const view = (models: SpeechModels['models']): SpeechModels => ({ current: models[0].id, chosenBy: 'check', graphics: false, models })
  const turboOpt = { id: turbo, name: 'Turbo', bytes: 5.7e8 }, smallOpt = { id: small, name: 'Small', bytes: 1.9e8 }

  it('a model that falls behind says by how much and what it costs the computer, and takes the "anyway" step', () => {
    const slow = { ...turboOpt, rtf: 1.5, pace: 'behind' as const, recommended: false }
    const v = view([slow, { ...smallOpt, rtf: 0.3, pace: 'live', recommended: true }])
    const lines = speechAdvice(slow, v)
    expect(lines[0]).toContain('1.5')
    expect(lines[0]).toContain('30 min')
    expect(lines[1]).toMatch(/fans, heat and battery/)
    expect(speechRisky(slow)).toBe(true)
  })

  it('too slow, or needing graphics, says so plainly', () => {
    const never = { ...turboOpt, rtf: null, pace: 'too-slow' as const, recommended: false }
    expect(speechAdvice(never, view([never]))[0]).toMatch(/hours, or not finish/)
    const gpu = { ...turboOpt, pace: 'too-slow' as const, recommended: false, needsGraphics: true }
    expect(speechAdvice(gpu, view([gpu]))[0]).toMatch(/Needs a graphics card/)
  })

  it('a smaller model than the recommended one trades accuracy for speed; the recommended one is not risky', () => {
    const rec = { ...turboOpt, rtf: 0.02, pace: 'live' as const, recommended: true }, lighter = { ...smallOpt, pace: 'untimed' as const, recommended: false }
    expect(speechAdvice(lighter, view([rec, lighter]))[0]).toMatch(/less accurate/)
    expect(speechRisky(lighter)).toBe(false)
    expect(speechRisky(rec)).toBe(false)
  })

  it('minutes behind for an hour-long meeting', () => {
    expect(minutesBehind(1.5)).toBe(30)
    expect(minutesBehind(1.001)).toBe(1)
  })
})
