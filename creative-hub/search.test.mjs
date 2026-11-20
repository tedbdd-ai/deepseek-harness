import assert from 'node:assert/strict'
import test from 'node:test'
import { openStore } from './store.mjs'
import { colorDistance, parseQuery } from './search.mjs'

const lookup = [{ id: 'mode:latex', key: 'latex' }, { id: 'mode:latex', key: 'rubber' }, { id: 'licht:neon', key: 'neon' }, { id: 'ort:aussen', key: 'außen' }, { id: 'ort:aussen', key: 'outdoor' }, { id: 'kamera:nah', key: 'close up' }]
const make = (store, title, description = 'x', library = 'clips') => store.createAsset({ library, title, description, source: library === 'generation' ? 'https://example.com/' + encodeURIComponent(title) + '.png' : '' }).id

test('parser turns tag words into chips and keeps free words', () => {
  const parsed = parseQuery('latex neon außen sofa -rubber "red door" close up', lookup)
  assert.deepEqual(parsed.include, ['mode:latex', 'licht:neon', 'ort:aussen', 'kamera:nah'])
  assert.deepEqual(parsed.terms, ['sofa'])
  assert.deepEqual(parsed.exclude, ['mode:latex'])
  assert.deepEqual(parsed.phrases, ['red door'])
})

test('synonyms, exclusion and ranking: confirmed tag before suggestion before full text', () => {
  const store = openStore(':memory:')
  const confirmed = make(store, 'Alpha'), suggested = make(store, 'Beta'), text = make(store, 'Gamma', 'a rubber doll')
  store.setTagState({ assetIds: [confirmed], tagIds: ['mode:latex'], state: 'bestaetigt' })
  store.addSuggestions(suggested, [{ tagId: 'mode:latex', origin: 'vision', confidence: 0.6 }])
  const found = store.search({ q: 'rubber', sort: 'relevance' })
  assert.deepEqual(found.items.map(item => item.id), [confirmed, suggested])
  const free = store.search({ q: 'doll' })
  assert.deepEqual(free.items.map(item => item.id), [text])
  assert.deepEqual(store.search({ q: '-latex' }).items.map(item => item.id).sort(), [text].sort())
  assert.equal(found.chips[0].tagId, 'mode:latex')
  store.close()
})

test('facet counts follow the filtered result and pages are limited', () => {
  const store = openStore(':memory:')
  const ids = Array.from({ length: 5 }, (_, i) => make(store, 'Bild ' + i))
  store.setTagState({ assetIds: ids, tagIds: ['licht:neon'], state: 'bestaetigt' })
  store.setTagState({ assetIds: ids.slice(0, 2), tagIds: ['ort:studio'], state: 'bestaetigt' })
  const result = store.search({ tags: ['ort:studio'], limit: 1 })
  assert.equal(result.total, 2)
  assert.equal(result.items.length, 1)
  assert.equal(result.nextOffset, 1)
  assert.deepEqual(result.facets.licht, [{ tagId: 'licht:neon', name: 'Neon', count: 2 }])
  assert.equal(store.search({ untagged: true }).total, 0)
  store.close()
})

test('discarded items are hidden unless asked for, stacks collapse runs', () => {
  const store = openStore(':memory:')
  const a = make(store, 'A', 'x', 'generation'), b = make(store, 'B', 'x', 'generation'), c = make(store, 'C', 'x', 'generation')
  store.setRun?.([a, b], 'run-1')
  store.setRating([c], -1)
  assert.equal(store.search({}).total, 2)
  assert.equal(store.search({ rating: 'all' }).total, 3)
  assert.equal(store.search({ rating: '-1' }).items[0].id, c)
  const stacked = store.search({ stack: true })
  assert.equal(stacked.total, 1)
  assert.equal(stacked.items[0].stackCount, 2)
  assert.equal(store.search({ run: 'run-1' }).total, 2)
  store.close()
})

test('similar images use feature print distance, colours use Lab distance', () => {
  const store = openStore(':memory:')
  const a = make(store, 'A', 'x', 'generation'), b = make(store, 'B', 'x', 'generation'), c = make(store, 'C', 'x', 'generation')
  const vec = values => Buffer.from(new Float32Array(values).buffer)
  store.saveAnalysis(a, { version: 1, featureprint: vec([0, 0]), colors: [{ hex: '#ff0000', share: 0.6 }] })
  store.saveAnalysis(b, { version: 1, featureprint: vec([1, 0]), colors: [{ hex: '#0000ff', share: 0.6 }] })
  store.saveAnalysis(c, { version: 1, featureprint: vec([9, 9]), text: 'Hinweis Schild' })
  assert.deepEqual(store.similar(a).map(item => item.id), [b, c])
  assert.deepEqual(store.search({ colors: ['#fa1010'] }).items.map(item => item.id), [a])
  assert.deepEqual(store.search({ q: 'schild' }).items.map(item => item.id), [c])
  assert.ok(colorDistance('#ff0000', '#ff0505') < 5)
  assert.deepEqual(store.unanalyzed(1), [])
  store.close()
})
