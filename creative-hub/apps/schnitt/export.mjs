/**
 * Renders the cut of a project with ffmpeg: video clips with trims are joined in order,
 * music and sound tracks are mixed in at their start times.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { InputError } from '../../store.mjs'

const run = promisify(execFile)
const num = value => Number(value.toFixed(3))

/** Validates the cut document and returns clips and tracks with numeric, ordered values. */
export function normalizeCut(data) {
  const clips = (Array.isArray(data?.clips) ? data.clips : []).map(clip => ({
    id: String(clip.id), assetId: String(clip.assetId), in: Math.max(Number(clip.in) || 0, 0), out: Number(clip.out) || 0,
    volume: Math.min(Math.max(Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1, 0), 2),
  }))
  for (const clip of clips) if (!(clip.out > clip.in)) throw new InputError('Ein Clip hat keine Länge. Prüfe Anfang und Ende.')
  const audio = (Array.isArray(data?.audio) ? data.audio : []).map(track => ({
    id: String(track.id), assetId: String(track.assetId), start: Math.max(Number(track.start) || 0, 0),
    volume: Math.min(Math.max(Number.isFinite(Number(track.volume)) ? Number(track.volume) : 1, 0), 2),
  }))
  if (clips.length > 60 || audio.length > 12) throw new InputError('Der Schnitt ist zu groß: höchstens 60 Clips und 12 Audiospuren.')
  return { clips, audio }
}

/**
 * @param {{ clips: object[], audio: object[] }} cut normalised cut.
 * @param {{ clips: { path: string, hasAudio: boolean }[], audio: { path: string }[], output: string, width?: number, height?: number, fps?: number }} files
 * @returns the ffmpeg argument list.
 */
export function buildExportArgs(cut, { clips, audio, output, width = 1280, height = 720, fps = 24 }) {
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y']
  for (const file of clips) args.push('-i', file.path)
  for (const file of audio) args.push('-i', file.path)
  const filters = []
  const parts = []
  cut.clips.forEach((clip, i) => {
    const length = num(clip.out - clip.in)
    filters.push(`[${i}:v]trim=start=${num(clip.in)}:end=${num(clip.out)},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}]`)
    filters.push(clips[i].hasAudio
      ? `[${i}:a]atrim=start=${num(clip.in)}:end=${num(clip.out)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,volume=${clip.volume}[a${i}]`
      : `anullsrc=r=44100:cl=stereo,atrim=0:${length},asetpts=PTS-STARTPTS[a${i}]`)
    parts.push(`[v${i}][a${i}]`)
  })
  filters.push(`${parts.join('')}concat=n=${cut.clips.length}:v=1:a=1[v][amain]`)
  const mixed = ['[amain]']
  cut.audio.forEach((track, j) => {
    const input = cut.clips.length + j
    const delay = Math.round(track.start * 1000)
    filters.push(`[${input}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${track.volume},adelay=${delay}|${delay}[m${j}]`)
    mixed.push(`[m${j}]`)
  })
  if (cut.audio.length) {
    // Without `normalize` amix divides every input by the input count; `volume` brings the level back.
    filters.push(`${mixed.join('')}amix=inputs=${mixed.length}:duration=first:dropout_transition=0,volume=${mixed.length}[aout]`)
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', cut.audio.length ? '[aout]' : '[amain]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output)
  return args
}

async function hasAudio(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path], { timeout: 10_000 })
  return stdout.trim().length > 0
}

/**
 * Renders the saved cut of a project and stores the result in the Library, assigned to the project.
 * @returns {{ id: string, seconds: number }} the new asset.
 */
export async function exportCut(store, projectId, data) {
  const cut = normalizeCut(data)
  if (!cut.clips.length) throw new InputError('Der Schnitt ist leer. Lege zuerst Clips in die Bildspur.')
  const dir = await mkdtemp(join(tmpdir(), 'atelier-cut-'))
  try {
    const write = async (assetId, name, wantVideo) => {
      const file = store.media(assetId)
      const usable = file && (wantVideo ? file.media_type.startsWith('video/') : /^(audio|video)\//.test(file.media_type))
      if (!usable) throw new InputError('Eine Datei des Schnitts gibt es nicht mehr. Entferne den Clip und füge ihn neu hinzu.', 409)
      const path = join(dir, name)
      await writeFile(path, Buffer.from(file.media))
      return path
    }
    const clips = []
    for (const [i, clip] of cut.clips.entries()) {
      const path = await write(clip.assetId, `clip${i}`, true)
      clips.push({ path, hasAudio: await hasAudio(path).catch(() => false) })
    }
    const audio = []
    for (const [j, track] of cut.audio.entries()) audio.push({ path: await write(track.assetId, `audio${j}`, false) })
    const output = join(dir, 'schnitt.mp4')
    try {
      await run('ffmpeg', buildExportArgs(cut, { clips, audio, output }), { timeout: 600_000 })
    } catch (error) {
      if (error.code === 'ENOENT') throw new InputError('Zum Exportieren braucht Atelier FFmpeg.', 503)
      throw new InputError('Der Schnitt ließ sich nicht rendern. Prüfe, ob alle Clips abspielbar sind.', 422)
    }
    const bytes = await readFile(output)
    const project = store.project(projectId)
    const seconds = cut.clips.reduce((sum, clip) => sum + clip.out - clip.in, 0)
    const { id } = store.createAsset({
      library: 'generation', title: `Schnitt · ${project.title}`, description: `Schnitt aus ${cut.clips.length} Clips, ${Math.round(seconds)} s`,
      mediaType: 'video/mp4', projectId,
    }, { bytes })
    return { id, seconds }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
