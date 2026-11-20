import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { InputError } from './store.mjs'

const run = promisify(execFile)
const videoFormats = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
}

export async function compressVideo(media) {
  const format = videoFormats[media?.media_type]
  if (!format) throw new InputError('Wähle eine gespeicherte MP4-, MOV- oder WebM-Datei.')
  const dir = await mkdtemp(join(tmpdir(), 'atelier-compress-'))
  try {
    const input = join(dir, 'original.' + format)
    const output = join(dir, 'kleiner.' + format)
    await writeFile(input, media.media)
    const dimensions = "scale=w='min(iw,if(gte(iw,ih),1920,1080))':h='min(ih,if(gte(iw,ih),1080,1920))':force_original_aspect_ratio=decrease:force_divisible_by=2"
    const codec = format === 'webm'
      ? ['-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus']
      : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac']
    await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
      '-i', input, '-map', '0:V:0', '-map', '0:a?', '-vf', dimensions, ...codec, '-b:a', '96k', output], { timeout: 180_000 })
    if ((await stat(output)).size >= media.media.length) throw new InputError('Die vorhandene Datei ist bereits kleiner als die komprimierte Fassung.', 422)
    return await readFile(output)
  } catch (error) {
    if (error instanceof InputError) throw error
    if (error.code === 'ENOENT') throw new InputError('Zum Verkleinern von Videos braucht Atelier FFmpeg.', 503)
    if (error.killed) throw new InputError('Das Komprimieren hat zu lange gedauert.', 422)
    throw new InputError('Das Video konnte nicht komprimiert werden.', 422)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Fits an oversized still image to the provider upload limit, keeping aspect and transparency. */
export async function fitReferenceImage(data, limit) {
  const dir = await mkdtemp(join(tmpdir(), 'atelier-reference-'))
  try {
    const input = join(dir, 'reference')
    const output = join(dir, 'reference.png')
    await writeFile(input, data)
    for (const edge of [2200, 1500]) {
      const scale = `scale=w='min(iw,${edge})':h='min(ih,${edge})':force_original_aspect_ratio=decrease`
      await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
        '-i', input, '-frames:v', '1', '-vf', scale, '-c:v', 'png', '-update', '1', '-y', output], { timeout: 30_000 })
      if ((await stat(output)).size <= limit) return await readFile(output)
    }
    throw new InputError('Die verkleinerte Referenz überschreitet weiterhin das Uploadlimit.', 413)
  } catch (error) {
    if (error instanceof InputError) throw error
    throw new InputError('Die große Bildreferenz konnte nicht verkleinert werden. Verwende in der Sammlung „Verkleinern“ und versuche es erneut.', 422)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
