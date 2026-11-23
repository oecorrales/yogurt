import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
const fake = <T>(app: ElectronApplication, fn: string, arg?: unknown): Promise<T> =>
  app.evaluate((_e, [fn, arg]) => (globalThis as unknown as Record<string, Record<string, (a?: unknown) => unknown>>).__fake__[fn as string](arg), [fn, arg] as const) as Promise<T>

test("the player's menu downloads the recording as one mixed file, or as its two tracks, and keeps the meeting's own audio", async () => {
  const userData = mkdtempSync(join(tmpdir(), 'yogurt-audio-download-'))
  const out = mkdtempSync(join(tmpdir(), 'yogurt-audio-download-out-'))
  const file = join(out, 'meeting.wav')
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: userData, YOGURT_RECORDING_EXPORT_PATH: file, YOGURT_RECORDING_EXPORT_DIR: out } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    const id = await fake<string>(app, 'bigMeeting', 8)
    await fake(app, 'go', `/note/${id}`)
    await page.getByRole('tab', { name: 'Transcript', exact: true }).click()

    await page.getByTestId('recording-menu').click()
    await page.getByTestId('recording-download').click()
    await expect(page.getByTestId('recording-download-toast')).toContainText('Recording saved')
    await expect(page.getByTestId('recording-download-toast')).toContainText('share it with care')
    const wav = readFileSync(file)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16_000)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44)
    expect(wav.length).toBeGreaterThan(44)
    // nothing half-written is left beside it
    expect(readdirSync(out).filter(f => f.startsWith('.yogurt-recording-'))).toEqual([])

    await page.getByTestId('recording-menu').click()
    await page.getByTestId('recording-download-tracks').click()
    await expect(page.getByTestId('recording-download-toast')).toContainText('Tracks saved')
    const saved = readdirSync(out).filter(f => f.endsWith(' - Me.wav') || f.endsWith(' - Them.wav'))
    expect(saved).toHaveLength(2)
    expect(readdirSync(out).some(f => f.endsWith('.part'))).toBe(false)
    expect(readFileSync(join(out, saved.find(f => f.endsWith(' - Me.wav'))!))).toEqual(readFileSync(join(userData, 'meetings', id, 'me.wav')))
    expect(existsSync(join(userData, 'meetings', id, 'them.wav'))).toBe(true)
  } finally { await app.close() }
})
