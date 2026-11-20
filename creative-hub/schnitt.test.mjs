import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildExportArgs, exportCut, normalizeCut } from './apps/schnitt/export.mjs'
import { openStore } from './store.mjs'

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('normalizeCut clamps values and rejects empty clips', () => {
  const cut = normalizeCut({ clips: [{ id: 'a', assetId: 'x', in: -2, out: 4, volume: 9 }], audio: [{ id: 'b', assetId: 'y', start: -1, volume: 0.5 }] })
  assert.deepEqual(cut.clips[0], { id: 'a', assetId: 'x', in: 0, out: 4, volume: 2 })
  assert.equal(cut.audio[0].start, 0)
  assert.throws(() => normalizeCut({ clips: [{ id: 'a', assetId: 'x', in: 3, out: 3 }] }), /Länge/)
})

test('export arguments trim every clip, add silence for clips without sound and mix extra tracks with a delay', () => {
  const cut = normalizeCut({ clips: [{ id: '1', assetId: 'a', in: 1, out: 4 }, { id: '2', assetId: 'b', in: 0, out: 2 }], audio: [{ id: 'm', assetId: 'c', start: 1.5, volume: 0.8 }] })
  const args = buildExportArgs(cut, { clips: [{ path: 'a.mp4', hasAudio: true }, { path: 'b.mp4', hasAudio: false }], audio: [{ path: 'm.mp3' }], output: 'out.mp4' })
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.deepEqual(args.filter((arg, i) => args[i - 1] === '-i'), ['a.mp4', 'b.mp4', 'm.mp3'])
  assert.match(graph, /\[0:v\]trim=start=1:end=4/)
  assert.match(graph, /anullsrc=r=44100:cl=stereo,atrim=0:2/)
  assert.match(graph, /concat=n=2:v=1:a=1\[v\]\[amain\]/)
  assert.match(graph, /\[2:a\].*volume=0\.8,adelay=1500\|1500\[m0\]/)
  assert.match(graph, /amix=inputs=2:duration=first/)
  assert.equal(args.at(-1), 'out.mp4')
  assert.equal(args[args.indexOf('-map', args.indexOf('[v]')) + 1], '[aout]')
})

test('an empty cut cannot be exported', async () => {
  const store = openStore(':memory:')
  const project = store.createProject({ title: 'Leer' })
  await assert.rejects(exportCut(store, project.id, { clips: [] }), /leer/)
  store.close()
})

test('export renders a real cut into the Library when ffmpeg is installed', { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'schnitt-'))
  try {
    const clip = join(dir, 'c.mp4')
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-pix_fmt', 'yuv420p', clip])
    const store = openStore(':memory:')
    const project = store.createProject({ title: 'Film' })
    const { id } = store.createAsset({ library: 'generation', title: 'Clip', mediaType: 'video/mp4', media: readFileSync(clip).toString('base64') })
    const result = await exportCut(store, project.id, { clips: [{ id: 'a', assetId: id, in: 0.5, out: 2.5 }, { id: 'b', assetId: id, in: 0, out: 1 }] })
    assert.equal(Math.round(result.seconds), 3)
    const saved = store.asset(result.id)
    assert.equal(saved.media_type, 'video/mp4')
    assert.ok(store.assets('', '', project.id).some(item => item.id === result.id))
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
