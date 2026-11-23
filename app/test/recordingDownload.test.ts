import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, dialog: {} }))
const { MIX_RATE, mixToWav, trackNames, wavHeader } = await import('../src/main/recordingDownload')

async function* pieces(all: Float32Array, size: number) { for (let i = 0; i < all.length; i += size) yield all.slice(i, i + size) }
const filled = (n: number, v: number) => new Float32Array(n).fill(v)
const out = () => join(mkdtempSync(join(tmpdir(), 'yogurt-download-')), 'mix.wav')
const samples = (file: string) => { const b = readFileSync(file); return Array.from({ length: (b.length - 44) / 2 }, (_, i) => b.readInt16LE(44 + i * 2)) }

describe('the recording as one file', () => {
  it('adds both sides sample by sample, on meeting time, whatever size their pieces come in', async () => {
    const file = out()
    const n = await mixToWav([pieces(filled(40_000, 0.25), 1600), pieces(filled(40_000, 0.5), 7000)], file)
    expect(n).toBe(40_000)
    const s = samples(file)
    expect(s).toHaveLength(40_000)
    expect(new Set(s)).toEqual(new Set([Math.round(0.75 * 32767)]))
  })

  it('the shorter side goes on as silence; the file is as long as the longer one', async () => {
    const file = out()
    await mixToWav([pieces(filled(MIX_RATE * 3, 0.5), 1600), pieces(filled(MIX_RATE, 0.25), 1600)], file)
    const s = samples(file)
    expect(s).toHaveLength(MIX_RATE * 3)
    expect(s[0]).toBe(Math.round(0.75 * 32767))
    expect(s.at(-1)).toBe(Math.round(0.5 * 32767))
  })

  it('two loud voices at once are held at full scale, never wrapped around', async () => {
    const file = out()
    await mixToWav([pieces(filled(100, 0.9), 50), pieces(filled(100, 0.9), 50)], file)
    expect(new Set(samples(file))).toEqual(new Set([32767]))
    await mixToWav([pieces(filled(100, -0.9), 50), pieces(filled(100, -0.9), 50)], file)
    expect(new Set(samples(file))).toEqual(new Set([-32767]))
  })

  it('writes a 16 kHz mono 16-bit WAV header with the real length; one track alone works too', async () => {
    const file = out()
    await mixToWav([pieces(filled(1234, 0.1), 100)], file)
    const b = readFileSync(file)
    expect(b.subarray(0, 44)).toEqual(wavHeader(1234))
    expect(b.toString('ascii', 0, 4)).toBe('RIFF')
    expect(b.readUInt32LE(24)).toBe(16_000)
    expect(b.readUInt16LE(22)).toBe(1)
    expect(b.readUInt32LE(40)).toBe(1234 * 2)
  })

  it('a track that fails stops the mix with the error', async () => {
    async function* broken() { yield filled(10, 0); throw new Error('decoding failed') }
    await expect(mixToWav([pieces(filled(100, 0.1), 10), broken()], out())).rejects.toThrow('decoding failed')
  })
})

describe('the separate tracks', () => {
  it('are named after the meeting and the side, keeping what they were recorded as', () => {
    const at = new Date(2026, 10, 23, 10, 0).getTime()
    expect(trackNames('Weekly sync', at, { me: '/m/me.ogg', them: '/m/them.ogg' })).toEqual({ me: 'Weekly sync 2026-11-23 - Me.ogg', them: 'Weekly sync 2026-11-23 - Them.ogg' })
    expect(trackNames('a/b: c', at, { them: '/m/them.m4a' })).toEqual({ them: 'a b c 2026-11-23 - Them.m4a' })
  })
})
