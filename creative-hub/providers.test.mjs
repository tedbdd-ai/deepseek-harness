import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from './core.mjs'
import * as hub from './host.mjs'
import { ProviderError } from './providers.mjs'
import { catalog, pickAspect, taskFor } from './providers/kie/models.mjs'
import { imageFingerprint } from './providers/http.mjs'
import * as litellm from './providers/litellm/host.mjs'
import { createHarness } from './test-harness.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII=', 'base64')

function fakeCredentials() {
  const values = new Map()
  return {
    values,
    async resolve(name) { return values.has(name) ? { value: values.get(name), source: 'store' } : undefined },
    async describe(name) { return { configured: values.has(name), source: values.has(name) ? 'store' : undefined, writable: true } },
    async set(name, value) { values.set(name, value) },
    async unset(name) { values.delete(name) },
  }
}

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-providers-'))
  const harness = createHarness()
  const credentials = fakeCredentials()
  harness.ctx.credentials = credentials
  t.after(() => {
    harness.unmountAll()
    rmSync(directory, { recursive: true, force: true })
  })
  harness.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  return { harness, credentials, directory }
}

const calls = []
const fakeProvider = {
  name: 'creativity-provider-fake',
  inject: ['creativeProviders'],
  apply(ctx) {
    ctx.effect(() => ctx.creativeProviders.register({
      id: 'fake',
      title: 'Fake',
      settings: [{ key: 'model', label: 'Modell', default: 'fake-1' }],
      secrets: [{ key: 'apiKey', label: 'Schlüssel', credential: 'FAKE_API_KEY' }],
      async models(env) { return [{ id: env.settings.model, title: env.settings.model }] },
      async generate(env, input) {
        calls.push({ key: await env.secret('apiKey'), input })
        return { images: [{ mediaType: 'image/png', data: png }], credits: 1.5 }
      },
      async removeBackground(env, { image }) {
        await env.secret('apiKey')
        if (!image.data.length) throw new ProviderError('leer')
        return { image: { mediaType: 'image/png', data: png } }
      },
    }))
  },
}

test('Provider plugins expose settings, secrets and actions through the hub', async t => {
  const { harness, credentials } = setup(t)
  const api = '/creativity-hub/api/'
  harness.mount(fakeProvider)
  const [listed] = await harness.json('GET', api + 'providers')
  assert.deepEqual(listed.capabilities, ['models', 'generate', 'removeBackground'])
  assert.equal(listed.secrets[0].configured, false)

  const missing = await harness.request('POST', api + 'images/generate', { provider: 'fake', prompt: 'Chrome-Typo' })
  assert.equal(missing.status, 400)
  assert.match(String(missing.result), /Schlüssel/)

  const configured = await harness.json('PUT', api + 'providers/fake', { settings: { model: 'fake-2' }, secrets: { apiKey: ' geheim ' } })
  assert.equal(configured.settings[0].value, 'fake-2')
  assert.equal(configured.secrets[0].configured, true)
  assert.equal(credentials.values.get('FAKE_API_KEY'), 'geheim')
  assert.ok(!JSON.stringify(configured).includes('geheim'))
  assert.deepEqual(await harness.json('GET', api + 'providers/fake/models'), [{ id: 'fake-2', title: 'fake-2' }])

  const idea = await harness.json('POST', api + 'projects', { title: 'Cover', snapshot: 'graphic' }, 201)
  const ref = await harness.json('POST', api + 'assets', { library: 'generation', title: 'Outfit_X', media: png.toString('base64'), mediaType: 'image/png' }, 201)
  const generated = await harness.json('POST', api + 'images/generate', { provider: 'fake', model: 'fake-2', prompt: 'Cover mit @Outfit_X', referenceIds: [ref.id], count: 2, ideaId: idea.id })
  assert.equal(generated.assets.length, 2)
  assert.equal(generated.credits, 3)
  assert.equal(calls.at(-1).key, 'geheim')
  assert.equal(calls.at(-1).input.references[0].mediaType, 'image/png')
  assert.match(generated.assets[0].description, /Referenzen: Outfit_X/)
  assert.equal((await harness.json('GET', api + 'assets?project=' + idea.id)).length, 2)

  const cut = await harness.json('POST', api + 'images/remove-background', { provider: 'fake', assetId: ref.id, title: 'Outfit_X' })
  assert.equal(cut.asset.title, 'Freigestellt: Outfit_X')
  await harness.json('POST', api + 'images/search', { provider: 'fake', query: 'logo' }, 400)
  await harness.json('POST', api + 'images/generate', { provider: 'missing', prompt: 'x' }, 404)
})

test('The extension route needs the token from the token file', async t => {
  const { harness, directory } = setup(t)
  const path = join(directory, 'launcher-token')
  assert.equal(statSync(path).mode & 0o777, 0o600)
  const token = readFileSync(path, 'utf8').trim()
  assert.equal((await harness.request('GET', '/creativity-launcher/api/projects')).status, 401)
  assert.equal((await harness.request('GET', '/creativity-launcher/api/projects', undefined, undefined, { authorization: 'Bearer falsch' })).status, 401)
  assert.deepEqual(await harness.json('GET', '/creativity-launcher/api/projects', undefined, 200, undefined, { authorization: 'Bearer ' + token }), [])
  // The browser extension writes with Sec-Fetch-Site: cross-site; the token authorizes it.
  await harness.json('POST', '/creativity-launcher/api/assets', { library: 'clips', title: 'Clip', source: 'https://example.com/' }, 201, 'cross-site', { authorization: 'Bearer ' + token })
  await harness.json('POST', '/creativity-hub/api/assets', { library: 'clips', title: 'Clip', source: 'https://example.com/' }, 403, 'cross-site')
})

test('LiteLLM provider sends chat image requests and reads the model list', async t => {
  const { harness, credentials } = setup(t)
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: body && JSON.parse(body) })
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gemini-3.8-flash' }, { id: 'nano-banana-2.1' }] }))
      // The proxy repeats the image, as Gemini image models behind LiteLLM do.
      const image = { image_url: { url: 'data:image/png;base64,' + png.toString('base64') } }
      res.end(JSON.stringify({ choices: [{ message: { content: '', images: [image, image] } }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  harness.mount(litellm, { baseURL: `http://127.0.0.1:${server.address().port}/v1` })
  credentials.values.set('LITELLM_API_KEY', 'sk-proxy')
  const api = '/creativity-hub/api/'
  assert.deepEqual((await harness.json('GET', api + 'providers/litellm/models')).map(model => model.id), ['nano-banana-2.1', 'gemini-3.8-flash'])
  const result = await harness.json('POST', api + 'images/generate', { provider: 'litellm', prompt: 'Flyer', aspect: '4:5' })
  assert.equal(result.assets.length, 1)
  const chat = seen.find(item => item.url === '/v1/chat/completions')
  assert.equal(chat.auth, 'Bearer sk-proxy')
  assert.equal(chat.body.model, 'nano-banana-2.1')
  assert.deepEqual(chat.body.modalities, ['text', 'image'])
  assert.equal(chat.body.extra_body.generationConfig.imageConfig.aspectRatio, '4:5')
})

test('Kie.ai catalog maps each model to its own input fields', () => {
  assert.ok(catalog.length > 1)
  assert.deepEqual(taskFor('gpt-image-2', { prompt: 'p', aspect: '4:5', refUrls: [] }), { model: 'gpt-image-2-text-to-image', input: { prompt: 'p', aspect_ratio: '4:5', resolution: '1K' } })
  assert.deepEqual(taskFor('seedream-5-5', { prompt: 'p', aspect: '4:5', refUrls: ['https://x/a.png'] }).input, { prompt: 'p', aspect_ratio: 'auto', output_format: 'png', image_urls: ['https://x/a.png'] })
  assert.equal(taskFor('flux-2-pro', { prompt: 'p', aspect: 'auto', refUrls: [] }).input.aspect_ratio, '1:1')
  assert.equal(pickAspect(['1:1', '16:9', '9:16'], '21:9'), '16:9')
  assert.throws(() => taskFor('grok-imagine-2', { prompt: 'p', aspect: '1:1', refUrls: Array(6).fill('u') }), error => error instanceof ProviderError && error.status === 400)
  assert.deepEqual(taskFor('custom/model', { prompt: 'p', aspect: '1:1', refUrls: ['u'] }), { model: 'custom/model', input: { prompt: 'p', aspect_ratio: '1:1', image_input: ['u'] } })
})

test('Image fingerprint ignores metadata chunks but not pixels', () => {
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'ascii'); return Buffer.concat([head, data, Buffer.alloc(4)]) }
  const iend = png.length - 12
  const tagged = text => Buffer.concat([png.subarray(0, iend), chunk('caBX', Buffer.from(text)), png.subarray(iend)])
  assert.equal(imageFingerprint(tagged('copy-1')), imageFingerprint(tagged('copy-2')))
  assert.equal(imageFingerprint(tagged('copy-1')), imageFingerprint(png))
  const other = Buffer.from(png)
  other[other.indexOf('IDAT') + 6] ^= 0xff
  assert.notEqual(imageFingerprint(other), imageFingerprint(png))
})

test('Kie imports sibling models with identical page titles from a family URL with a selected tab', async t => {
  const { harness } = setup(t)
  harness.mount(await import('./providers/kie/host.mjs'))
  const ids = ['studio-fast-text-to-image', 'studio-pro-text-to-image', 'studio-pro-image-to-image']
  t.mock.method(globalThis, 'fetch', async address => {
    if (address.endsWith('/llms.txt')) return new Response(ids.map(id => `[Studio](https://docs.kie.ai/market/${id}.md)`).join('\n'))
    const id = address.split('/').pop().replace('.md', '')
    const image = id.endsWith('image-to-image') ? '\n                    image_urls:\n                      type: array\n                      items:\n                        type: string' : ''
    return new Response('# Studio - Modell\n```yaml\n' + `paths:
  /api/v1/jobs/createTask:
    post:
      requestBody:
        content:
          application/json:
            schema:
              properties:
                model:
                  default: ${id}
                input:
                  properties:
                    prompt:
                      type: string${image}` + '\n```')
  })
  const models = await harness.ctx.creativeProviders.call('kie', 'resolveModels', { url: 'https://kie.ai/studio?model=studio-fast-text-to-image' })
  assert.deepEqual(models.map(m => m.id), ['kie:studio-fast', 'kie:studio-pro'])
  assert.equal(models[1].variants.text.model, ids[1])
  assert.equal(models[1].variants.edit.model, ids[2])
})

test('fal converts a saved fashion image to a downloadable GLB and a Library video', async t => {
  const { harness, credentials } = setup(t)
  harness.mount(await import('./providers/fal/host.mjs'), { pollMs: 1 })
  await credentials.set('FAL_KEY', 'test-key')
  const submissions = []
  const queueRoot = 'https://queue.fal.run/'
  const glb = Buffer.alloc(24)
  glb.write('glTF')
  glb.writeUInt32LE(2, 4)
  glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(4, 12)
  glb.write('JSON', 16)
  glb.write('{}  ', 20)
  const mp4 = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') {
      const kind = url.endsWith('/trellis-2') ? 'mesh' : 'video'
      submissions.push({ url, body: JSON.parse(options.body) })
      return Response.json({ status_url: queueRoot + kind + '/status', response_url: queueRoot + kind + '/result' })
    }
    if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' })
    if (url === queueRoot + 'mesh/result') return Response.json({ model_glb: { url: 'https://v3.fal.media/reference.glb' } })
    if (url === queueRoot + 'video/result') return Response.json({ video: { url: 'https://v3.fal.media/reference.mp4' } })
    return new Response(url.endsWith('.glb') ? glb : mp4)
  })

  const base = '/creativity-hub/api'
  const person = await harness.json('POST', base + '/assets', { library: 'clips', title: 'Person', mediaType: 'image/png', media: png.toString('base64') }, 201)
  for (const [kind, type, bytes] of [['mesh', 'model/gltf-binary', glb], ['video', 'video/mp4', mp4]]) {
    const { assets: [item] } = await harness.json('POST', base + '/images/reference-media', { provider: 'fal', kind, assetId: person.id })
    assert.equal(item.media_type, type)
    assert.equal(item.library, 'generation')
    assert.deepEqual((await harness.request('GET', base + '/media/' + item.id)).result, bytes)
  }
  assert.equal(submissions[0].body.image_url, 'data:image/png;base64,' + png.toString('base64'))
  assert.match(submissions[1].url, /kling-video.*image-to-video$/)
  assert.equal(submissions[1].body.duration, '5')
})

test('Re-encoded copies with slightly different pixels count as the same image', async () => {
  const { deflateSync } = await import('node:zlib')
  const { sameImage } = await import('./providers/http.mjs')
  const crc = buf => { let c = ~0; for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 } return ~c >>> 0 }
  const chunk = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length); head.write(type, 4, 'ascii'); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), body]))); return Buffer.concat([head, body, tail]) }
  const makePng = pixel => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(64, 0); ihdr.writeUInt32BE(64, 4); ihdr[8] = 8; ihdr[9] = 2
    const rows = []
    for (let y = 0; y < 64; y++) { const row = [0]; for (let x = 0; x < 64; x++) row.push(...pixel(x, y)); rows.push(Buffer.from(row)) }
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
  }
  const gradient = (x, y) => [x * 4, y * 4, 128]
  const original = makePng(gradient)
  const copy = makePng((x, y) => x === 10 && y === 10 ? [0, 0, 0] : (x + y) % 3 ? gradient(x, y) : gradient(x, y).map(v => Math.min(255, v + 2)))
  const other = makePng((x, y) => [255 - x * 4, 255 - y * 4, 20])
  assert.equal(sameImage(original, copy), true)
  assert.equal(sameImage(original, other), false)
})
