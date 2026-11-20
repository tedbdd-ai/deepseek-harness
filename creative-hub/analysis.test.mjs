import assert from 'node:assert/strict'
import test from 'node:test'
import { ANALYSIS_VERSION, createAssetAnalyzer, labelTags, metaTags, resolveAnalysisConfig, textTags } from './asset-analysis.mjs'
import { openStore } from './store.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII='
const names = (store, id) => store.assetTags([id])[id].map(tag => `${tag.facet}:${tag.name}:${tag.state}:${tag.origin}`).sort()
const fakeVision = result => async () => ({ classify: async () => result, close: async () => {} })

test('labels map to vocabulary through synonyms and respect the threshold', () => {
  const store = openStore(':memory:')
  const lookup = store.tagLookup()
  const vision = { labels: [{ name: 'street', confidence: 0.4 }, { name: 'beach', confidence: 0.1 }, { name: 'boots', confidence: 0.3 }] }
  assert.deepEqual(labelTags(vision, lookup, 0.25).map(item => item.tagId).sort(), ['mode:stiefel', 'ort:straße'])
  assert.deepEqual(labelTags(vision, lookup, 0.5), [])
  assert.throws(() => resolveAnalysisConfig({ labelThreshold: 2 }), /labelThreshold/)
  store.close()
})

test('prompt text and metadata become tags', () => {
  const store = openStore(':memory:')
  const id = store.createAsset({ library: 'generation', title: 'Szene', mediaType: 'image/png', media: png,
    description: 'Prompt: woman in latex coat, neon light, close-up\nModell: Seedream 4 über Kie.ai\nReferenzen: Ref A' }).id
  const asset = store.asset(id)
  const found = textTags(asset, store.tagLookup()).map(item => item.tagId).sort()
  assert.deepEqual(found, ['kamera:nah', 'licht:neon', 'mode:latex', 'mode:mantel'])
  const meta = metaTags(asset, store).map(item => item.tagId)
  assert.deepEqual(meta, ['art:generiert', 'quelle:playground', 'modell:seedream-4'])
  store.close()
})

test('analyzer analyses every asset once, keeps human decisions and never writes after stop', async () => {
  const store = openStore(':memory:')
  const vision = { labels: [{ name: 'people', confidence: 0.6 }], face: 0.9, person: 0.9, colors: [{ hex: '#112233', share: 1 }], featureprint: Buffer.from(new Float32Array([1, 2]).buffer).toString('base64'), text: '' }
  const image = store.createAsset({ library: 'generation', title: 'Latex Porträt', mediaType: 'image/png', media: png, description: 'Prompt: latex portrait' }).id
  const note = store.createAsset({ library: 'clips', title: 'Notiz', description: 'Idee für Klinik' }).id
  store.setTagState({ assetIds: [image], tagIds: ['mode:latex'], state: 'abgelehnt' })
  const analyzer = createAssetAnalyzer(store, { labelThreshold: 0.25, vision: fakeVision(vision), frame: async () => null })
  await analyzer.drain()
  assert.ok(names(store, image).includes('motiv:Person:vorschlag:vision'))
  assert.ok(names(store, image).includes('art:Generiert:bestaetigt:meta'))
  assert.ok(!names(store, image).some(tag => tag.startsWith('mode:Latex')), 'rejected stays rejected')
  assert.ok(names(store, note).includes('ort:Klinik:vorschlag:text'))
  assert.equal(store.analysis(image).version, ANALYSIS_VERSION)
  assert.deepEqual(store.search({ colors: ['#112233'] }).items.map(item => item.id), [image])
  assert.deepEqual(store.unanalyzed(ANALYSIS_VERSION), [])
  const late = store.createAsset({ library: 'clips', title: 'Später', description: 'Studio' }).id
  analyzer.stop()
  await analyzer.drain()
  assert.deepEqual(store.assetTags([late])[late], [])
  store.close()
})

test('videos use a still frame and survive a missing ffmpeg', async () => {
  const store = openStore(':memory:')
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(16)])
  const video = store.createAsset({ library: 'generation', title: 'Video · Test', mediaType: 'video/mp4', media: mp4.toString('base64'), description: 'Prompt: night street' }).id
  let seen = 0
  const analyzer = createAssetAnalyzer(store, { labelThreshold: 0.25, vision: fakeVision({ labels: [{ name: 'street', confidence: 0.5 }], colors: [], featureprint: null, text: '' }), frame: async () => { seen++; return null } })
  await analyzer.drain()
  assert.equal(seen, 1)
  assert.ok(names(store, video).includes('art:Video:bestaetigt:meta'))
  assert.ok(names(store, video).includes('licht:Nacht:vorschlag:text'))
  store.close()
})

test('legacy generations without a run are grouped by prompt, model and time', () => {
  const store = openStore(':memory:')
  const make = (title, prompt) => store.createAsset({ library: 'generation', title, source: 'https://example.com/' + title + '.png', description: `Prompt: ${prompt}\nModell: M über P` }).id
  const [a, b, c] = [make('a', 'x'), make('b', 'x'), make('c', 'y')]
  assert.equal(store.groupLegacyRuns(), 2)
  const stacked = store.search({ stack: true })
  assert.equal(stacked.total, 2)
  assert.ok([a, b].includes(stacked.items.find(item => item.stackCount === 2).id))
  assert.equal(store.asset(c).run_id, '')
  store.close()
})
