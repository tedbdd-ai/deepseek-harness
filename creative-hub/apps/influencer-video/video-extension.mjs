import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { InputError, mediaLimit } from '../../store.mjs'

const run = promisify(execFile)
const ffmpeg = (args, timeout = 120_000, encoding = 'utf8') => run('ffmpeg',
  ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { timeout, encoding })
const even = value => Math.max(2, Math.round(value / 2) * 2)

async function inspect(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { timeout: 10_000 })
  const { streams, format } = JSON.parse(stdout)
  const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  const duration = Number(video?.duration) || Number(format?.duration)
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new Error('Keine lesbare Videospur.')
  const rotation = video.side_data_list?.find(item => Number.isFinite(item.rotation))?.rotation ?? 0
  const [sarWidth, sarHeight] = (video.sample_aspect_ratio ?? '').split(':').map(Number)
  const sar = sarWidth > 0 && sarHeight > 0 ? sarWidth / sarHeight : 1
  const dimensions = [even(video.width * sar), even(video.height)]
  if (Math.abs(rotation) % 180 === 90) dimensions.reverse()
  const [frames, seconds] = video.avg_frame_rate.split('/').map(Number)
  const rate = frames / seconds
  return { duration, dimensions, fps: rate >= 12 && rate <= 60 ? video.avg_frame_rate : '30',
    audio: streams.some(stream => stream.codec_type === 'audio') }
}

async function withTemp(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'atelier-video-'))
  try { return await callback(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

export async function checkExtensionSource(readSource) {
  return withTemp(async dir => {
    const path = join(dir, 'source.mov')
    await writeFile(path, readSource())
    let source
    try {
      await ffmpeg(['-version'], 5000)
      source = await inspect(path)
    } catch (error) {
      if (error.code === 'ENOENT') throw new InputError('Für Videoverlängerungen braucht Atelier FFmpeg und FFprobe.', 503)
      throw new InputError('Der Ausgangsclip konnte nicht als Video gelesen werden.')
    }
    if (source.duration < 2 || source.duration > 30.05) throw new InputError('Der Ausgangsclip muss zwischen 2 und 30 Sekunden lang sein.')
  })
}

export async function assembleExtension({ original, extension, direction, format, lastFrame }) {
  return withTemp(async dir => {
    const prepend = direction === 'before'
    const paths = [join(dir, 'source.mov'), join(dir, 'extension.mov')]
    await Promise.all([writeFile(paths[0], original), writeFile(paths[1], extension)])
    const [source, segment] = await Promise.all(paths.map(inspect))
    const [width, height] = source.dimensions
    const withAudio = source.audio || segment.audio
    const filters = [source, segment].flatMap(({ duration, audio }, index) => [
      `[${index}:V:0]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${source.fps},format=yuv420p[v${index}]`,
      ...(withAudio ? [(audio ? `[${index}:a:0]aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo,apad`
        : 'anullsrc=r=48000:cl=stereo') + `,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`] : []),
    ])
    const order = prepend ? [1, 0] : [0, 1]
    const concat = order.map(index => `[v${index}]` + (withAudio ? `[a${index}]` : '')).join('')
    filters.push(concat + 'concat=n=2:v=1:a=' + (withAudio ? '1[outv][outa]' : '0[outv]'))
    const output = join(dir, 'joined.' + format)
    await ffmpeg(['-i', paths[0], '-i', paths[1], '-filter_complex', filters.join(';'),
      '-map', '[outv]', ...(withAudio ? ['-map', '[outa]', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-movflags', '+faststart', output])
    const type = format === 'mov' ? 'video/quicktime' : 'video/mp4'
    if ((await stat(output)).size > mediaLimit(type)) throw new Error('Das zusammengesetzte Video ist zu groß für die Library.')
    const file = { mediaType: type, data: await readFile(output) }
    if (!lastFrame || !prepend) return { file }
    try {
      return { file, frame: await readLastFrame(output, dir) }
    } catch {
      return { file, frameError: 'Der letzte Frame konnte aus dem zusammengesetzten Video nicht gespeichert werden.' }
    }
  })
}

export async function extractLastFrame(data) {
  return withTemp(async dir => {
    const source = join(dir, 'video')
    await writeFile(source, data)
    return readLastFrame(source, dir)
  })
}

async function readLastFrame(source, dir) {
  const jpg = join(dir, 'last.jpg')
  await ffmpeg(['-sseof', '-0.5', '-i', source, '-vf', 'reverse', '-frames:v', '1', '-update', '1', jpg])
  return { mediaType: 'image/jpeg', data: await readFile(jpg) }
}

export async function mediaTimeline(data) {
  return withTemp(async dir => {
    const input = join(dir, 'media')
    await writeFile(input, data)
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input], { timeout: 10_000 })
    const { streams, format } = JSON.parse(stdout)
    const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
    const audio = streams.find(stream => stream.codec_type === 'audio')
    const duration = Number((video ?? audio)?.duration) || Number(format?.duration)
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new InputError('Für diese Datei ist keine Timeline-Übersicht verfügbar.', 422)
    const frameCount = video ? 8 : 0
    const strip = video && ffmpeg(['-i', input, '-map', '0:V:0', '-an', '-vf',
      `fps=${(frameCount / duration).toFixed(8)}:round=up,scale=160:90:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=${frameCount}x1`,
      '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '4', '-f', 'image2pipe', 'pipe:1'], 30_000, 'buffer')
    const samples = audio && run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', input,
      '-map', '0:a:0', '-vn', '-af', 'aresample=2000:async=1:first_pts=0,apad', '-t', String(duration),
      '-ac', '2', '-f', 's16le', 'pipe:1'], { encoding: 'buffer', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
    const [image, sound] = await Promise.all([strip, samples])
    const bins = Array(96).fill(0)
    if (sound) {
      const buffer = sound.stdout
      for (let i = 0; i + 1 < buffer.length; i += 2) {
        const bin = Math.floor(i * bins.length / buffer.length)
        bins[bin] = Math.max(bins[bin], Math.abs(buffer.readInt16LE(i)))
      }
    }
    const scale = Math.max(1, ...bins)
    return { duration, frameCount, image: image ? image.stdout.toString('base64') : undefined, peaks: sound ? bins.map(value => +(value / scale).toFixed(3)) : [] }
  })
}
