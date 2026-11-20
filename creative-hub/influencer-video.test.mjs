import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from './core.mjs'
import * as hub from './host.mjs'
import * as influencer from './apps/influencer-video/host.mjs'
import * as kie from './providers/kie/host.mjs'
import { createHarness } from './test-harness.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII=', 'base64')
const mp4 = Buffer.from('000000146674797069736f6d0000020069736f6d', 'hex')
const base = '/creativity-influencer/api'

test('Influencer Video submits both Kie workflows and stores paid results once, even after a restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'influencer-video-'))
  const h = createHarness()
  h.ctx.credentials = { resolve: () => ({ value: 'fake-key' }) }
  const mount = () => {
    h.mount(core, { databasePath: join(directory, 'hub.sqlite') })
    h.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
    h.mount(kie)
    h.mount(influencer)
  }
  t.after(() => { h.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  mount()

  const submissions = []
  let statusChecks = 0
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    const url = new URL(address)
    if (url.pathname === '/api/file-base64-upload') {
      assert.match(JSON.parse(options.body).base64Data, /^data:image\/png;base64,/)
      return Response.json({ code: 200, data: { downloadUrl: 'https://example.test/keyframe.png' } })
    }
    if (url.pathname === '/api/file-stream-upload') {
      const file = options.body.get('file')
      assert.equal(file.type, 'video/mp4')
      assert.equal(options.body.get('uploadPath'), 'atelier')
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), mp4)
      return Response.json({ code: 200, data: { downloadUrl: 'https://example.test/motion.mp4' } })
    }
    if (url.pathname.endsWith('/createTask')) {
      submissions.push(JSON.parse(options.body))
      return Response.json({ code: 200, data: { taskId: 'kie-' + submissions.length } })
    }
    if (url.pathname.endsWith('/recordInfo')) {
      statusChecks++
      return Response.json({ code: 200, data: { state: 'success', creditsConsumed: 42, resultJson: '{"resultUrls":["https://example.test/output.mp4"]}' } })
    }
    assert.equal(url.pathname, '/output.mp4')
    return new Response(mp4)
  })

  const upload = (type, data) => h.json('POST', base + '/media?title=Quelle', data, 201, 'same-origin', { 'content-type': type })
  const image = await upload('image/png', png)
  const motion = await upload('video/mp4', mp4)
  const project = await h.json('POST', '/creativity-hub/api/projects', { title: 'Video' }, 201)
  const draft = { requestId: randomUUID(), imageId: image.id, projectId: project.id, mode: 'keyframe', duration: '5', prompt: 'A person walks in the rain.', sound: false }
  const [first, replay] = await Promise.all([
    h.json('POST', base + '/jobs', draft, 201),
    h.json('POST', base + '/jobs', draft, 201),
  ])
  assert.equal(first.id, replay.id)
  assert.equal(submissions.length, 1)
  assert.deepEqual(submissions[0], { model: 'kling-2.6/image-to-video', input: {
    prompt: draft.prompt, duration: '5', sound: false, image_urls: ['https://example.test/keyframe.png'],
  } })
  const second = await h.json('POST', base + '/jobs', {
    requestId: randomUUID(), imageId: image.id, mode: 'motion', motionId: motion.id, orientation: 'video', resolution: '720p',
  }, 201)
  assert.deepEqual(submissions[1], { model: 'kling-2.6/motion-control', input: {
    input_urls: ['https://example.test/keyframe.png'], video_urls: ['https://example.test/motion.mp4'], mode: '720p', character_orientation: 'video',
  } })

  h.unmountAll()
  mount()
  assert.deepEqual((await h.json('GET', base + '/jobs')).map(job => job.status), ['queued', 'queued'])
  const refresh = id => h.json('POST', base + '/jobs/' + id + '/refresh', {})
  const [done, duplicate] = await Promise.all([refresh(first.id), refresh(first.id)])
  assert.equal(done.assetId, duplicate.assetId)
  assert.equal(done.credits, 42)
  assert.equal(statusChecks, 1)
  assert.equal((await refresh(second.id)).status, 'done')
  assert.equal((await h.json('GET', '/creativity-hub/api/assets?library=generation')).length, 2)
  assert.deepEqual((await h.json('GET', '/creativity-hub/api/assets?project=' + project.id)).map(item => item.id), [done.assetId])
  assert.deepEqual((await h.request('GET', '/creativity-hub/api/media/' + done.assetId)).result, mp4)
})

test('Seedance 2.5 Flash sends model-specific inputs and saves the MOV and last frame', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'influencer-seedance-'))
  const h = createHarness()
  t.after(() => { h.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  h.ctx.credentials = { resolve: () => ({ value: 'fake-key' }) }
  h.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  h.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  h.mount(kie)
  h.mount(influencer)

  const mov = Buffer.from('0000001466747970717420200000000071742020', 'hex')
  const wav = Buffer.from('524946460400000057415645', 'hex')
  const jpg = Buffer.from('ffd8ffd9', 'hex')
  const uploads = []
  const requests = []
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    const path = new URL(address).pathname
    if (path === '/api/file-stream-upload') {
      const file = options.body.get('file')
      uploads.push(file.type)
      return Response.json({ code: 200, data: { downloadUrl: 'https://example.test/' + file.name } })
    }
    if (path.endsWith('/createTask')) {
      requests.push(JSON.parse(options.body))
      return Response.json({ code: 200, data: { taskId: 'seedance-' + requests.length } })
    }
    if (path.endsWith('/recordInfo')) return Response.json({ code: 200, data: {
      state: 'success', creditsConsumed: 42, resultJson: JSON.stringify({ resultUrls: ['https://example.test/output.mov'], lastFrameUrl: ['https://example.test/frame.jpg'] }),
    } })
    if (path === '/frame.jpg') return new Response(jpg)
    assert.equal(path, '/output.mov')
    return new Response(mov)
  })
  const upload = (type, data) => h.json('POST', base + '/media', data, 201, 'same-origin', { 'content-type': type })
  const [image, video, audio] = await Promise.all([upload('image/png', png), upload('video/quicktime', mov), upload('audio/wav', wav)])
  const apps = await h.json('GET', '/creativity-hub/api/apps')
  assert.ok(apps.some(app => app.id === 'video-playground' && app.title === 'Video Playground'))
  assert.equal((await h.request('GET', '/creativity-apps/video-playground/studio-monitor.mjs')).status, 200)
  const settings = { duration: 12, aspect: '9:16', resolution: '480p', format: 'mov', audio: false, filter: true, webSearch: true, lastFrame: true }
  const common = { model: 'seedance', prompt: 'Ein ruhiger Schwenk.', settings }
  const submit = (mode, extras = {}, status = 201) => h.json('POST', base + '/jobs', { requestId: randomUUID(), ...common, mode, ...extras }, status)
  const text = await submit('text')
  assert.deepEqual(requests[0], { model: 'bytedance/seedance-2-5-flash', input: {
    prompt: common.prompt, duration: 12, aspect_ratio: '9:16', resolution: '480p', output_format: 'mov',
    generate_audio: false, nsfw_checker: true, web_search: true, return_last_frame: true,
  } })
  await submit('frames', { imageId: image.id, endId: image.id, prompt: '' })
  assert.equal(requests[1].input.first_frame_url, 'https://example.test/reference.png')
  assert.equal(requests[1].input.last_frame_url, 'https://example.test/reference.png')
  assert.equal(requests[1].input.aspect_ratio, 'adaptive')
  assert.equal(requests[1].input.web_search, undefined)
  await submit('references', { referenceIds: { audio: [audio.id] } })
  assert.deepEqual(requests[2].input.reference_audio_urls, ['https://example.test/reference.wav'])
  assert.equal(requests[2].input.web_search, undefined)
  await submit('references', { referenceIds: { image: [image.id], video: [video.id], audio: [audio.id] }, settings: { ...settings, task: 'edit' } })
  assert.equal(requests[3].input.omni_reference_task_type, 'edit')
  assert.equal(requests[3].input.duration, -1)
  assert.equal(requests[3].input.aspect_ratio, 'adaptive')
  assert.deepEqual(requests[3].input.reference_video_urls, ['https://example.test/reference.mov'])
  await submit('references', { referenceIds: { image: [image.id, image.id] } }, 400)
  await submit('references', { referenceIds: { audio: [audio.id] }, settings: { ...settings, task: 'extend' } }, 400)
  assert.equal(requests.length, 4)
  assert.deepEqual(uploads, ['image/png', 'image/png', 'audio/wav', 'image/png', 'video/quicktime', 'audio/wav'])
  const done = await h.json('POST', base + '/jobs/' + text.id + '/refresh', {})
  assert.ok(done.assetId && done.frameId)
  assert.deepEqual((await h.json('GET', '/creativity-hub/api/assets?library=generation')).map(item => item.media_type).sort(), ['image/jpeg', 'video/quicktime'])
})

test('Seedance prompt improvement uses text context, preserves reference marks and leaves video jobs untouched', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'influencer-prompt-'))
  const h = createHarness()
  t.after(() => { h.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  h.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  h.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  h.mount(influencer)
  const path = base + '/prompt/improve'
  const draft = { mode: 'references', task: 'extend', duration: 8, audio: false,
    referenceCounts: { video: 1, image: 1 }, prompt: 'Setze @Video1 mit dem Outfit aus @Image1 fort.' }
  await h.json('POST', path, draft, 409)
  let calls = 0
  let text = 'Setze @video1 direkt fort. Das Outfit bleibt wie in @Image1.'
  h.ctx.creativeProviders.register({ id: 'test-chat', title: 'Test Chat', chat(_, request) {
    calls++
    assert.deepEqual(JSON.parse(request.prompt), {
      draft: draft.prompt, mode: 'references', task: 'extend', durationSeconds: 8,
      generateAudio: false, availableReferences: ['@Image1', '@Video1'], extensionDirection: 'ab dem letzten Bild',
    })
    assert.match(request.system, /Beim Verlängern/)
    assert.equal(request.images, undefined)
    return { text }
  } })
  await h.json('POST', path, { ...draft, prompt: '@Audio2' }, 400)
  assert.equal(calls, 0)
  assert.deepEqual(await h.json('POST', path, draft), {
    prompt: 'Setze @Video1 direkt fort. Das Outfit bleibt wie in @Image1.',
  })
  text = 'Setze @Video1 fort.'
  await h.json('POST', path, draft, 502)
  text = 'Setze @Video1 mit @Image1 und @Video2 fort.'
  await h.json('POST', path, draft, 502)
  assert.equal(calls, 3)
  assert.deepEqual(await h.json('GET', base + '/jobs'), [])
})

test('Seedance video extension stores the original and the paid continuation as a single video', async t => {
  if (['ffmpeg', 'ffprobe'].some(tool => spawnSync(tool, ['-version']).status !== 0)) return t.skip('FFmpeg and FFprobe required')
  const directory = mkdtempSync(join(tmpdir(), 'influencer-extend-'))
  const h = createHarness()
  t.after(() => { h.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  const sourcePath = join(directory, 'source.mp4')
  const segmentPath = join(directory, 'segment.mp4')
  const ffmpeg = (...args) => execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args])
  ffmpeg('-f', 'lavfi', '-i', 'color=red:s=64x64:r=24:d=5', '-f', 'lavfi', '-i', 'sine=d=5', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', sourcePath)
  ffmpeg('-f', 'lavfi', '-i', 'color=blue:s=66x64:r=30:d=5', '-c:v', 'libx264', segmentPath)

  const register = () => h.ctx.creativeProviders.register({
    id: 'kie', title: 'Kie.ai',
    startVideo(_, input) {
      const { duration, aspect, task } = input.seedance.settings
      assert.deepEqual({ duration, aspect, task }, { duration: 5, aspect: 'adaptive', task: 'extend' })
      assert.match(input.prompt, /Ausgangsclip @Video1 .* um 5 Sekunden/)
      assert.match(input.prompt, /Ein farbiger Übergang.$/)
      return { taskId: 'fake-extension', model: 'bytedance/seedance-2-5-flash' }
    },
    videoStatus() { return { status: 'done', file: { mediaType: 'video/mp4', data: readFileSync(segmentPath) } } },
  })
  function mount() {
    h.mount(core, { databasePath: join(directory, 'hub.sqlite') })
    h.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
    register()
    h.mount(influencer)
  }
  mount()
  const source = await h.json('POST', base + '/media?title=Original', readFileSync(sourcePath), 201, 'same-origin', { 'content-type': 'video/mp4' })
  const draft = { model: 'seedance', mode: 'references', prompt: 'Ein farbiger Übergang.',
    referenceIds: { video: [source.id] }, settings: { duration: 5, aspect: '9:16', resolution: '720p', format: 'mp4', task: 'extend', lastFrame: true } }
  await h.json('POST', base + '/jobs', { ...draft, requestId: randomUUID(), extensionDirection: 'sideways' }, 400)
  const mediaPath = '/creativity-hub/api/media/' + source.id
  const range = await h.request('GET', mediaPath, undefined, 'same-origin', { range: 'bytes=4-7' })
  assert.equal(range.status, 206)
  assert.equal(range.result.toString(), 'ftyp')
  const audioOnly = execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=d=2', '-f', 'wav', 'pipe:1'])
  const audio = await h.json('POST', base + '/media', audioOnly, 201, 'same-origin', { 'content-type': 'audio/wav' })
  const overview = id => h.json('GET', base + '/media/' + id + '/timeline')
  const [videoTimeline, audioTimeline] = await Promise.all([overview(source.id), overview(audio.id)])
  assert.equal(videoTimeline.duration, 5)
  assert.equal(videoTimeline.frameCount, 8)
  assert.equal(Buffer.from(videoTimeline.image, 'base64').subarray(0, 3).toString('hex'), 'ffd8ff')
  assert.equal(videoTimeline.peaks.length, 96)
  assert.ok(videoTimeline.peaks.some(value => value > 0))
  assert.equal(audioTimeline.duration, 2)
  assert.equal(audioTimeline.frameCount, 0)
  assert.equal(audioTimeline.image, undefined)
  assert.equal(audioTimeline.peaks.length, 96)
  const after = await h.json('POST', base + '/jobs', { ...draft, requestId: randomUUID() }, 201)
  const before = await h.json('POST', base + '/jobs', { ...draft, requestId: randomUUID(), extensionDirection: 'before' }, 201)
  h.unmountAll()
  mount()

  for (const [job, prepend] of [[after, false], [before, true]]) {
    const done = await h.json('POST', base + '/jobs/' + job.id + '/refresh', {})
    assert.equal(done.status, 'done')
    assert.equal(done.extensionError, undefined)
    assert.equal(Boolean(done.frameId), prepend)
    const file = join(directory, 'joined.mp4')
    writeFileSync(file, (await h.request('GET', '/creativity-hub/api/media/' + done.assetId)).result)
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]).toString())
    assert.ok(Math.abs(Number(probe.format.duration) - 10) < 0.1)
    assert.deepEqual(probe.streams.map(stream => stream.codec_type), ['video', 'audio'])
    const first = ffmpeg('-ss', '1', '-i', file, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1')
    const last = ffmpeg('-ss', '6', '-i', file, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1')
    assert.equal(first[0] > first[2], !prepend)
    assert.equal(last[0] > last[2], prepend)
  }
})
