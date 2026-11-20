import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import * as core from './core.mjs'
import * as hub from './host.mjs'
import * as playground from './playground/host.mjs'
import { fieldsOf, parseYaml, pickParams } from './providers/schema.mjs'
import { createHarness } from './test-harness.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII=', 'base64')
const fields = [
  { key: 'prompt', type: 'prompt', label: 'Prompt', required: true, description: '' },
  { key: 'aspect_ratio', type: 'enum', label: 'Format', options: ['auto', '1:1', '16:9'], required: false, description: '' },
]
const runs = []
const fakeKie = {
  name: 'creativity-provider-fake-kie',
  inject: ['creativeProviders'],
  apply(ctx) {
    ctx.effect(() => ctx.creativeProviders.register({
      id: 'kie',
      title: 'Fake Kie',
      async resolveModels(env, { url }) {
        return [{ id: 'kie:fake', title: 'Fake Bild', provider: 'kie', providerTitle: 'Kie.ai', page: url, variants: url.includes('edit')
          ? { edit: { model: 'fake/edit', fields: [...fields, { key: 'input_urls', type: 'images', label: 'Bilder', required: true, description: '' }] } }
          : { text: { model: 'fake/text', fields } } }]
      },
      async runModel(env, input) {
        runs.push(input)
        if (input.input.prompt === 'kaputt') throw new Error('Kie.ai ist gerade ausgelastet.')
        return { images: [{ mediaType: 'image/png', data: png }], credits: 2 }
      },
    }))
  },
}

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-playground-'))
  const harness = createHarness()
  t.after(() => { harness.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  harness.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  harness.mount(fakeKie)
  harness.mount(playground)
  return harness
}

async function settled(harness) {
  for (let i = 0; i < 50; i++) {
    const list = await harness.json('GET', '/creativity-playground/api/runs')
    if (list.every(run => run.results.every(result => result.status !== 'running'))) return list
    await sleep(10)
  }
  throw new Error('Läufe sind nicht fertig geworden.')
}

test('Playground adds models by page address and merges their variants', async t => {
  const harness = setup(t)
  const api = '/creativity-playground/api'
  await harness.json('POST', api + '/models', { url: 'https://example.com/model' }, 400)
  await harness.json('POST', api + '/models', { url: 'https://kie.ai/fake' }, 201)
  const [merged] = await harness.json('POST', api + '/models', { url: 'https://kie.ai/fake-edit' }, 201)
  assert.deepEqual(Object.keys(merged.variants).sort(), ['edit', 'text'])
  assert.equal((await harness.json('GET', api + '/models')).length, 1)
  await harness.json('DELETE', api + '/models/kie%3Afake')
  assert.deepEqual(await harness.json('GET', api + '/models'), [])
  await harness.json('POST', api + '/models', { url: 'https://kie.ai/fake' }, 403, 'cross-site')
})

test('A run sends one prompt to each model and saves the results in the Library', async t => {
  const harness = setup(t)
  const api = '/creativity-playground/api'
  await harness.json('POST', api + '/models', { url: 'https://kie.ai/fake' }, 201)
  await harness.json('POST', api + '/runs', { prompt: '', modelIds: ['kie:fake'] }, 400)
  const run = await harness.json('POST', api + '/runs', { prompt: 'Spiegelsaal', modelIds: ['kie:fake'], count: 2, params: { aspect_ratio: '16:9', seed: 5, resolution: '8K' } }, 201)
  assert.equal(run.results.length, 2)
  const [done] = await settled(harness)
  assert.deepEqual(done.results.map(result => result.status), ['done', 'done'])
  assert.deepEqual(runs.at(-1).input, { aspect_ratio: '16:9', prompt: 'Spiegelsaal' })
  const library = await harness.json('GET', '/creativity-hub/api/assets?library=generation')
  assert.equal(library.length, 2)
  assert.match(library[0].description, /Modell: Fake Bild über Kie\.ai/)

  const clip = await harness.json('POST', '/creativity-hub/api/assets', { library: 'clips', title: 'Mantel', media: png.toString('base64'), mediaType: 'image/png' }, 201)
  const edit = await harness.json('POST', api + '/runs', { prompt: 'Anders', modelIds: ['kie:fake'], referenceIds: [clip.id] }, 201)
  assert.equal(edit.results[0].status, 'failed')
  assert.match(edit.results[0].error, /bearbeitet keine Bilder/)

  await harness.json('POST', api + '/runs', { prompt: 'kaputt', modelIds: ['kie:fake'] }, 201)
  const [failed] = await settled(harness)
  assert.equal(failed.results[0].status, 'failed')
  assert.match(failed.results[0].error, /ausgelastet/)
})

test('Schema reader turns provider specs into Playground fields', () => {
  const spec = parseYaml(`
input:
  type: object
  required:
    - prompt
  properties:
    prompt:
      type: string
      description: >-
        What to draw.
    input_urls:
      type: array
      maxItems: 16
      items:
        type: string
        format: uri
    aspect_ratio:
      type: string
      enum:
        - auto
        - '1:1'
      default: auto
    seed:
      type: integer
      minimum: 0
`)
  const list = fieldsOf(spec.input)
  assert.deepEqual(list.map(field => [field.key, field.type]), [['prompt', 'prompt'], ['input_urls', 'images'], ['aspect_ratio', 'enum'], ['seed', 'integer']])
  assert.equal(list[0].description, 'What to draw.')
  assert.equal(list[1].maxItems, 16)
  assert.deepEqual(list[2].options, ['auto', '1:1'])
  assert.deepEqual(pickParams(list, { aspect_ratio: '1:1', seed: '7.4', input_urls: ['x'], other: 1 }), { aspect_ratio: '1:1', seed: 7 })
  const fal = fieldsOf({ properties: { image_size: { anyOf: [{ $ref: '#/x' }, { type: 'string', enum: ['square', 'auto'] }], default: 'auto' } } })
  assert.deepEqual(fal[0].options, ['square', 'auto'])
})

test('Model-specific edit inputs keep the assigned reference order and vary only on request', async t => {
  const h = setup(t)
  const api = '/creativity-playground/api'
  await h.json('POST', api + '/models', { url: 'https://kie.ai/fake-edit' }, 201)
  const refs = []
  for (const title of ['Person', 'Tanz']) {
    const item = await h.json('POST', '/creativity-hub/api/assets', { library: 'clips', title, media: png.toString('base64'), mediaType: 'image/png' }, 201)
    refs.push(item.id)
  }
  await h.json('POST', api + '/runs', {
    prompt: 'Probe', modelIds: ['kie:fake'], referenceIds: refs, count: 2,
    studio: { vary: true, roles: { [refs[0]]: 'Identität', [refs[1]]: 'Pose' } },
    modelParams: { [JSON.stringify(['kie:fake', 'edit', 'fake/edit'])]: { aspect_ratio: '16:9' } },
  }, 201)
  const [done] = await settled(h)
  assert.deepEqual(done.results.map(r => r.status), ['done', 'done'])
  const inputs = runs.slice(-2).map(r => r.input)
  assert.notEqual(inputs[0].prompt, inputs[1].prompt)
  assert.match(inputs[0].prompt, /Reference 1: Match facial geometry.*Reference 2: Use only body orientation/s)
  assert.equal(inputs[0].aspect_ratio, '16:9')
})

test('Inline references resolve against the outgoing image order and missing images stop the run', async t => {
  const h = setup(t)
  const api = '/creativity-playground/api'
  await h.json('POST', api + '/models', { url: 'https://kie.ai/fake-edit' }, 201)
  const [person, outfit] = await Promise.all(['Person', 'Jacke'].map(title =>
    h.json('POST', '/creativity-hub/api/assets', { library: 'clips', title, media: png.toString('base64'), mediaType: 'image/png' }, 201)))
  const body = {
    prompt: 'Die Person aus @Bild5 im Outfit von @Bild2.',
    modelIds: ['kie:fake'],
    referenceIds: [person.id, outfit.id],
    studio: { referenceLabels: { [person.id]: 5, [outfit.id]: 2 }, roles: { [person.id]: 'Identität', [outfit.id]: 'Kleidung' } },
  }
  const missing = await h.json('POST', api + '/runs', { ...body, referenceIds: [person.id] }, 400)
  assert.match(missing.error, /@Bild2 ist nicht angehängt/)
  await h.json('POST', api + '/runs', body, 201)
  const [done] = await settled(h)
  assert.equal(done.results[0].status, 'done')
  assert.match(runs.at(-1).input.prompt, /^Die Person aus Image 1 im Outfit von Image 2\./)
  assert.match(runs.at(-1).input.prompt, /Do not transfer the wearer’s face/)
  assert.deepEqual(runs.at(-1).images.map(file => file.referenceLabel), ['Image 1 (identity)', 'Image 2 (garment)'])
})

test('Partial batches retry just the missing slots in place with the original prompt', async t => {
  const h = setup(t)
  const api = '/creativity-playground/api'
  await h.json('POST', api + '/models', { url: 'https://kie.ai/fake-edit' }, 201)
  const ref = await h.json('POST', '/creativity-hub/api/assets', {
    library: 'clips', title: 'Tasse', media: png.toString('base64'), mediaType: 'image/png',
  }, 201)
  const provider = h.ctx.creativeProviders
  const originalCall = provider.call.bind(provider)
  const sent = []
  t.mock.method(provider, 'call', async (id, action, input) => {
    assert.equal(action, 'runModel')
    sent.push(input.input)
    if (sent.length === 1 || sent.length === 3) throw Error('Kein Bild geliefert.')
    return originalCall(id, action, input)
  })
  const run = await h.json('POST', api + '/runs', { prompt: 'Eine Tasse wie @Bild7.', modelIds: ['kie:fake'],
    count: 4, referenceIds: [ref.id], studio: { referenceLabels: { [ref.id]: 7 } }, params: { aspect_ratio: '16:9' } }, 201)
  const [partial] = await settled(h)
  assert.deepEqual(partial.results.map(r => r.status), ['failed', 'done', 'failed', 'done'])
  const retry = () => h.json('POST', api + '/runs/' + run.id + '/retry', {})
  await Promise.all([retry(), retry()])
  const [done] = await settled(h)
  assert.deepEqual(done.results.map(r => r.status), Array(4).fill('done'))
  for (const i of [1, 3]) assert.deepEqual(done.results[i], partial.results[i])
  for (const i of [0, 2]) assert.equal(done.results[i].attempt, 1)
  await retry()
  assert.deepEqual(sent, Array(6).fill({ prompt: 'Eine Tasse wie Image 1.', aspect_ratio: '16:9' }))
})

test('Remix direction gives each image one garment job and a situation per image', async () => {
  const { compileDirection, referencePlan } = await import('./playground/direction.mjs')
  const ids = ['a', 'b', 'c']
  const studio = {
    roles: { a: 'Identität', b: 'Kleidung: Jacke/Mantel', c: 'Material & Farbe' }, situation: 'Backstage im Club', angle: 'Seitenansicht',
    remixes: [null, { roles: { b: 'Kleidung: Oberteil', c: 'Muster & Details' }, situation: 'Laufsteg', angle: 'Bodennähe' }],
  }
  const positions = referencePlan('Look mit @Bild1', studio, ids)
  const first = compileDirection('Look mit @Bild1', { ...studio, remixes: undefined }, ids, positions, 'm', 'kie', 0, 2)
  assert.match(first, /The person is backstage at a club, leaning/)
  assert.match(first, /One main person: the person from Image 1/)
  assert.match(first, /Mix these pieces into one outfit/)
  assert.match(first, /inside the scene, not in front of it/)
  assert.match(first, /Natural photo look/)
  assert.match(first, /Reference 2: Use its jacket, coat or cape/)
  const second = compileDirection('Look mit @Bild1', studio, ids, positions, 'm', 'kie', 1, 2)
  assert.match(second, /The person is on a runway, mid-stride/)
  assert.match(second, /Camera angle: low angle/)
  assert.match(second, /Reference 2: Use its top/)
  assert.match(second, /Reference 3: Use its trims/)
})

test('Scrabble uses the original brief and active endpoint while keeping exact reference labels', async t => {
  const harness = setup(t)
  const api = '/creativity-playground/api'
  const [person, location] = await Promise.all(['Person', 'Leuchtturm'].map(title => harness.json('POST', '/creativity-hub/api/assets', {
    library: 'clips', title, media: png.toString('base64'), mediaType: 'image/png',
  }, 201)))
  const prompts = ['Die Person aus @Bild5 steht links neben den Seekarten in der Küche aus @Bild2.', 'Die Person aus @Bild5 steht in der Küche aus @Bild2 zwischen Seekarten im Vordergrund und einem runden Fenster.']
  let reply = [prompts[0]]
  const calls = []
  harness.ctx.creativeProviders.register({ id: 'text', title: 'Test-Textmodell', chat(_, input) {
    calls.push(input)
    return { text: JSON.stringify({ prompts: reply }), model: 'vision-test' }
  } })
  await harness.json('POST', api + '/models', { url: 'https://kie.ai/fake-edit' }, 201)
  const [model] = await harness.json('GET', api + '/models')
  assert.ok(model.guides.edit.tip)
  assert.equal(model.guides.edit.source, 'https://kie.ai/fake-edit')
  const body = { prompt: 'Mein eigener Text', modelIds: [model.id], referenceIds: [person.id, location.id], labels: { [person.id]: 5, [location.id]: 2 }, words: 'Sturm, Seekarten, Küche', count: 2, previous: ['Alte Bildfassung'], camera: { angle: 'Augenhöhe', light: 'Fensterlicht' } }
  assert.deepEqual(await harness.json('POST', api + '/scrabble', body), { prompts: [prompts[0]], model: 'vision-test' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].images.map(file => file.referenceLabel), ['@Bild5', '@Bild2'])
  assert.deepEqual(JSON.parse(calls[0].prompt), { count: 1, keywords: body.words, references: ['@Bild5', '@Bild2'],
    originalPrompt: body.prompt, targetModels: [{ model: 'fake/edit', provider: 'kie', task: 'edit', tip: model.guides.edit.tip, schemaHint: '', settings: {} }], previousScenes: ['Alte Bildfassung'] })
  assert.match(calls[0].system, /visible in the finished frame/)
  assert.match(calls[0].system, /Keep unspecified visual choices open/)
  reply = ['Eine erfundene Marke @Bild1 neben @Bild2.']
  assert.match((await harness.json('POST', api + '/scrabble', body, 502)).error, /Bildmarken/)
  assert.equal((await harness.json('GET', api + '/runs')).length, 0)

  const run = await harness.json('POST', api + '/runs', {
    prompt: 'Mein geänderter Text mit @Bild5 und @Bild2.',
    modelIds: ['kie:fake'], count: 2, referenceIds: body.referenceIds,
    studio: { referenceLabels: body.labels, prompts },
  }, 201)
  assert.match(run.results[0].sentPrompt, /^Mein geänderter Text mit Image 1 und Image 2\./)
  assert.match(run.results[1].sentPrompt, /^Die Person aus Image 1 steht in der Küche aus Image 2/)
  assert.doesNotMatch(run.results[1].sentPrompt, /Reference 1:|Natural photo look/)
  await settled(harness)
})

test('An empty prompt with four references repeats the reference-only request four times', async t => {
  const harness = setup(t)
  const api = '/creativity-playground/api'
  await harness.json('POST', api + '/models', { url: 'https://kie.ai/fake-edit' }, 201)
  const ids = []
  for (const title of ['Ref 1', 'Ref 2', 'Ref 3', 'Ref 4']) {
    const item = await harness.json('POST', '/creativity-hub/api/assets', { library: 'clips', title, media: png.toString('base64'), mediaType: 'image/png' }, 201)
    ids.push(item.id)
  }
  const studio = { referenceLabels: Object.fromEntries(ids.map((id, i) => [id, i + 4])) }
  const draft = await harness.json('POST', api + '/scrabble', { referenceIds: ids, labels: studio.referenceLabels })
  assert.deepEqual(draft, { prompts: ['@Bild4 @Bild5 @Bild6 @Bild7'], model: '' })
  const run = await harness.json('POST', api + '/runs', {
    prompt: ' ', referenceIds: ids, studio, modelIds: ['kie:fake'], count: 4, params: { aspect_ratio: '16:9' },
  }, 201)
  assert.equal(run.prompt, draft.prompts[0])
  const expected = [
    'Image 1 Image 2 Image 3 Image 4',
    'Image numbers refer to the attached files in the order supplied. Follow the purpose given to each image in the request.',
    ...[1, 2, 3, 4].map(number => `Reference ${number}: Use it only for the purpose specified in the request or as broad visual context.`),
    'Keep each source separate. A source used for clothing, pose, style, location or lighting supplies only those attributes. Do not transfer the source wearer’s identity or body shape from such images. When editing an existing scene, preserve the original person and all details outside the requested change.',
  ].join('\n')
  assert.deepEqual(run.results.map(result => result.sentPrompt), Array(4).fill(expected))
  await settled(harness)
  const start = runs.length
  await harness.json('POST', api + '/runs', {
    prompt: '', referenceIds: ids, studio: { ...studio, lens: '35 mm Reportage' }, modelIds: ['kie:fake'], count: 4, params: { aspect_ratio: '16:9' },
  }, 201)
  await settled(harness)
  const sent = runs.slice(start)
  assert.equal(sent.length, 4)
  assert.ok(sent.every(job => job.input.aspect_ratio === '16:9' && job.input.prompt.includes('Lens: 35mm reportage lens')))
  assert.equal(new Set(sent.map(job => job.input.prompt)).size, 1)
})

test('HotAPI receives the locked appearance and each assigned role in attachment order', async t => {
  const harness = setup(t)
  const path = '/creativity-playground/api'
  const calls = []
  harness.ctx.creativeProviders.register({
    id: 'abliteration', title: 'Abliteration AI',
    chat(_, input) {
      calls.push(input)
      return { text: JSON.stringify({ prompts: ['Die Person aus @Bild5 steht bei Fensterlicht und trägt den Mantel aus @Bild2.'] }) }
    },
  })
  const sent = []
  harness.ctx.creativeProviders.register({
    id: 'hotapi', title: 'HotAPI',
    resolveModels: async () => [{
      id: 'hotapi:seedream', provider: 'hotapi', title: 'Seedream', providerTitle: 'HotAPI',
      variants: { edit: { model: 'seedream-5.0-pro-spicy/image-edit', fields: [...fields, { key: 'image', type: 'images', maxItems: 10 }] } },
    }],
    runModel: async (_, request) => {
      sent.push(request)
      return { images: [{ mediaType: 'image/png', data: png }] }
    },
  })
  const [person, coat] = await Promise.all(['Person', 'Mantel'].map(title => harness.json('POST', '/creativity-hub/api/assets', {
    library: 'clips', title, media: png.toString('base64'), mediaType: 'image/png',
  }, 201)))
  const referenceIds = [coat.id, person.id]
  const labels = { [person.id]: 5, [coat.id]: 2 }
  const roles = { [person.id]: 'Identität', [coat.id]: 'Kleidung' }
  const appearance = '@Bild5 mit kurzen schwarzen Haaren und Sommersprossen.'
  const draft = await harness.json('POST', path + '/scrabble', { referenceIds, labels, roles, appearance, words: 'Fensterlicht' })
  assert.deepEqual(calls[0].images, [])
  const ask = JSON.parse(calls[0].prompt)
  assert.equal(ask.fixedSubjectAppearance, appearance)
  assert.deepEqual(ask.referenceRoles, { '@Bild2': 'garment', '@Bild5': 'identity' })
  await harness.json('POST', path + '/models', { url: 'https://hotapi.ai/models/seedream-5.0-pro-spicy/image-edit' }, 201)
  await harness.json('POST', path + '/runs', { modelIds: ['hotapi:seedream'], prompt: draft.prompts[0], referenceIds,
    studio: { roles, appearance, referenceLabels: labels },
  }, 201)
  await settled(harness)
  assert.match(sent[0].input.prompt, /Fixed subject appearance: Image 2 mit kurzen schwarzen Haaren und Sommersprossen\./)
  assert.match(sent[0].input.prompt, /Image 1 — garment:.*Do not transfer the wearer/)
  assert.match(sent[0].input.prompt, /Image 2 — identity:.*Preserve this person’s identity/)
  assert.match(sent[0].input.prompt, /anatomically plausible/)
  assert.doesNotMatch(sent[0].input.prompt, /Image undefined|@Bild/)
})
