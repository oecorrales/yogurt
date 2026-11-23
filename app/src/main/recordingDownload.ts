import { app, dialog, type BrowserWindow } from 'electron'
import { copyFile, mkdtemp, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileNameFor } from '../shared/exportNotes'
import { t } from '../shared/i18n'
import { isFake } from './paths'

/** what the mixed file is: 16 kHz mono 16-bit WAV, what speech-to-text models take as it is (about 115 MB an hour) */
export const MIX_RATE = 16_000
/** samples mixed at a time (one second) */
const CHUNK = MIX_RATE

export type DownloadResult = 'saved' | 'cancelled' | 'missing' | 'recording' | 'failed'
type Track = 'me' | 'them'

/** a 44-byte WAV header for this many 16-bit mono samples */
export function wavHeader(samples: number, rate = MIX_RATE): Buffer {
  const b = Buffer.alloc(44)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  return b
}

const joined = (a: Float32Array<ArrayBufferLike>, b: Float32Array<ArrayBufferLike>): Float32Array<ArrayBufferLike> => {
  if (!a.length) return b
  const all = new Float32Array(a.length + b.length)
  all.set(a); all.set(b, a.length)
  return all
}

/**
 * Both sides of the meeting in one file: the tracks are on meeting time from their first sample, so the mix adds them
 * sample by sample, a second at a time (never the whole meeting in memory). The shorter one goes on as silence.
 * Resolves with the samples written.
 */
export async function mixToWav(tracks: AsyncIterable<Float32Array>[], out: string): Promise<number> {
  const srcs = tracks.map((tr) => ({ it: tr[Symbol.asyncIterator](), buf: new Float32Array(0) as Float32Array<ArrayBufferLike>, done: false }))
  const fh = await open(out, 'w')
  let total = 0
  try {
    await fh.write(wavHeader(0))
    for (;;) {
      for (const s of srcs) {
        while (!s.done && s.buf.length < CHUNK) {
          const r = await s.it.next()
          if (r.done) s.done = true
          else s.buf = joined(s.buf, r.value)
        }
      }
      const n = Math.min(CHUNK, Math.max(0, ...srcs.map((s) => s.buf.length)))
      if (!n) break
      const pcm = Buffer.alloc(n * 2)
      for (let i = 0; i < n; i++) {
        let v = 0
        for (const s of srcs) if (i < s.buf.length) v += s.buf[i]
        // two people at once can add up past full scale: held at the edge, never wrapped around
        pcm.writeInt16LE(Math.round((v > 1 ? 1 : v < -1 ? -1 : v) * 32767), i * 2)
      }
      for (const s of srcs) s.buf = s.buf.subarray(Math.min(n, s.buf.length))
      await fh.write(pcm)
      total += n
    }
    await fh.write(wavHeader(total), 0, 44, 0)
    return total
  } finally {
    await fh.close()
    for (const s of srcs) if (!s.done) await s.it.return?.(undefined)
  }
}

/** the names the separate tracks are saved under: "Weekly sync 2026-11-23 - Me.ogg" */
export function trackNames(title: string, startedAt: number, files: Partial<Record<Track, string>>): Partial<Record<Track, string>> {
  const base = fileNameFor(title, startedAt).replace(/\.md$/, '')
  const out: Partial<Record<Track, string>> = {}
  for (const tr of ['me', 'them'] as const) {
    const f = files[tr]
    if (f) out[tr] = `${base} - ${tr === 'me' ? t('Me') : t('Them')}${extname(f)}`
  }
  return out
}

/**
 * Settings → the note's player → Download: the recording as one file (both sides mixed, to listen to or hand to another
 * speech-to-text tool) or as its two tracks as they were recorded. The file goes where the save dialog says, never to a
 * path the window made up, and is written beside it first so a failed save leaves nothing half-written.
 */
export function createRecordingDownload(d: {
  meeting: (id: string) => { title: string; startedAt: number } | undefined
  /** the meeting's track files, none while it records */
  files: (id: string) => Promise<Partial<Record<Track, string>> | 'recording'>
  decode: (file: string) => AsyncIterable<Float32Array>
  window: () => BrowserWindow | undefined
}) {
  let last: string | undefined
  const win = () => { const w = d.window(); return w && !w.isDestroyed() ? w : undefined }

  async function saveMixed(id: string): Promise<DownloadResult> {
    const m = d.meeting(id)
    if (!m) return 'missing'
    const files = await d.files(id)
    if (files === 'recording') return 'recording'
    const list = Object.values(files).filter((f): f is string => !!f)
    if (!list.length) return 'missing'
    // tests name the file themselves; people get the save panel
    let path = isFake() ? process.env.YOGURT_RECORDING_EXPORT_PATH : undefined
    if (!path) {
      const opts = { title: t('Download recording'), defaultPath: join(app.getPath('downloads'), fileNameFor(m.title, m.startedAt).replace(/\.md$/, '.wav')),
        filters: [{ name: t('Audio'), extensions: ['wav'] }] }
      const w = win()
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return 'cancelled'
      path = r.filePath
    }
    let staging: string | undefined
    try {
      staging = await mkdtemp(join(dirname(path), '.yogurt-recording-'))
      const file = join(staging, 'recording.wav')
      const samples = await mixToWav(list.map(d.decode), file)
      await rename(file, path)
      last = path
      console.log(`recording downloaded: one file, ${Math.round(samples / MIX_RATE)} s`)
      return 'saved'
    } catch (err) {
      console.error('downloading the recording failed', err)
      return 'failed'
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true }).catch((err) => console.warn('download cleanup failed', err))
    }
  }

  async function saveTracks(id: string): Promise<DownloadResult> {
    const m = d.meeting(id)
    if (!m) return 'missing'
    const files = await d.files(id)
    if (files === 'recording') return 'recording'
    const names = trackNames(m.title, m.startedAt, files)
    if (!Object.keys(names).length) return 'missing'
    let folder = isFake() ? process.env.YOGURT_RECORDING_EXPORT_DIR : undefined
    if (!folder) {
      const opts = { title: t('Save separate tracks'), defaultPath: app.getPath('downloads'), properties: ['openDirectory' as const, 'createDirectory' as const] }
      const w = win()
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled || !r.filePaths[0]) return 'cancelled'
      folder = r.filePaths[0]
    }
    try {
      for (const tr of ['me', 'them'] as const) {
        const from = files[tr], name = names[tr]
        if (!from || !name) continue
        const to = join(folder, name)
        const part = join(folder, `.${basename(name)}.part`)
        await copyFile(from, part)
        await rename(part, to)
        last = to
      }
      console.log(`recording downloaded: ${Object.keys(names).length} separate tracks`)
      return 'saved'
    } catch (err) {
      console.error('saving the separate tracks failed', err)
      return 'failed'
    }
  }

  return {
    save: (id: string, kind: 'mixed' | 'tracks') => (kind === 'tracks' ? saveTracks(id) : saveMixed(id)),
    /** the file just saved, for Show in Finder / File Explorer */
    last: () => last,
  }
}
