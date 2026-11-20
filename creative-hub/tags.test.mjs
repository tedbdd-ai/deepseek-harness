import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from './store.mjs'

const clip = (store, title, extra = {}) => store.createAsset({ library: 'clips', title, description: 'x', ...extra }).id
const names = (store, id) => store.assetTags([id])[id].map(tag => `${tag.facet}:${tag.name}:${tag.state}`)

test('vocabulary is seeded once and keeps user deletions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tags-'))
  const file = join(dir, 'hub.sqlite')
  let store = openStore(file)
  const mode = store.tagVocabulary().find(facet => facet.id === 'mode')
  assert.ok(mode.tags.find(tag => tag.name === 'Latex').aliases.includes('rubber'))
  store.deleteTag('mode:latex')
  store.close()
  store = openStore(file)
  assert.equal(store.tagVocabulary().find(facet => facet.id === 'mode').tags.some(tag => tag.name === 'Latex'), false)
  store.close()
})

test('legacy JSON tags migrate to facets, manual as confirmed and auto as suggestions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tags-'))
  const file = join(dir, 'hub.sqlite')
  const old = openStore(file)
  const manual = clip(old, 'Von Hand')
  const auto = clip(old, 'Automatisch')
  old.close()
  const raw = new DatabaseSync(file)
  raw.prepare("UPDATE assets SET tags = ?, tag_source = 'manual' WHERE id = ?").run(JSON.stringify(['Person', 'Innenraum', 'Eigenes Wort']), manual)
  raw.prepare("UPDATE assets SET tags = ?, tag_source = 'auto' WHERE id = ?").run(JSON.stringify(['Outfit']), auto)
  raw.prepare('DELETE FROM asset_tags').run()
  raw.prepare("DELETE FROM settings WHERE namespace = 'hub:tags'").run()
  raw.close()
  const store = openStore(file)
  assert.deepEqual(names(store, manual).sort(), ['frei:Eigenes Wort:bestaetigt', 'motiv:Person:bestaetigt', 'ort:Innen:bestaetigt'])
  assert.deepEqual(names(store, auto), ['mode:Outfit:vorschlag'])
  store.close()
})

test('suggestions never overwrite a human decision', () => {
  const store = openStore(':memory:')
  const id = clip(store, 'Bild')
  store.setTagState({ assetIds: [id], tagIds: ['mode:latex'], state: 'abgelehnt' })
  store.setTagState({ assetIds: [id], tagIds: ['ort:studio'], state: 'bestaetigt' })
  store.addSuggestions(id, [{ tagId: 'mode:latex', origin: 'vision', confidence: 0.9 }, { tagId: 'ort:studio', origin: 'vision', confidence: 0.1 }, { tagId: 'licht:neon', origin: 'vision', confidence: 0.6 }])
  assert.deepEqual(names(store, id).sort(), ['licht:Neon:vorschlag', 'ort:Studio:bestaetigt'])
  store.addSuggestions(id, [{ tagId: 'licht:neon', origin: 'text', confidence: 0.8 }])
  assert.equal(store.assetTags([id])[id].find(tag => tag.tagId === 'licht:neon').origin, 'text')
  store.close()
})

test('editing legacy tags rejects suggestions the user removed', () => {
  const store = openStore(':memory:')
  const id = clip(store, 'Bild')
  store.saveAutomaticTags(id, ['Person', 'Outfit'])
  store.editTags({ ids: [id], remove: ['Outfit'] })
  store.addSuggestions(id, [{ tagId: 'mode:outfit', origin: 'vision', confidence: 0.9 }])
  assert.deepEqual(names(store, id), ['motiv:Person:bestaetigt'])
  assert.deepEqual(store.asset(id).tags, ['Person'])
  store.close()
})

test('merging keeps the stronger assignment and the old name as synonym', () => {
  const store = openStore(':memory:')
  const a = clip(store, 'A'), b = clip(store, 'B')
  const mine = store.createTag({ facet: 'frei', name: 'Gummi-Look' }).id
  store.setTagState({ assetIds: [a], tagIds: [mine], state: 'bestaetigt' })
  store.addSuggestions(a, [{ tagId: 'mode:latex', origin: 'vision', confidence: 0.4 }])
  store.addSuggestions(b, [{ tagId: 'mode:latex', origin: 'vision', confidence: 0.7 }])
  store.mergeTags(mine, 'mode:latex')
  assert.deepEqual(names(store, a), ['mode:Latex:bestaetigt'])
  assert.equal(store.resolveTag('gummi-look'), 'mode:latex')
  assert.equal(store.tagVocabulary().find(facet => facet.id === 'frei').tags.length, 0)
  store.close()
})

test('deleting a tag removes its assignments and reports how many', () => {
  const store = openStore(':memory:')
  const a = clip(store, 'A')
  store.setTagState({ assetIds: [a], tagIds: ['mode:latex'], state: 'bestaetigt' })
  assert.deepEqual(store.deleteTag('mode:latex'), { id: 'mode:latex', removed: 1 })
  assert.deepEqual(store.assetTags([a])[a], [])
  assert.deepEqual(store.asset(a).tags, [])
  store.close()
})

test('rating and tag creation validate their input', () => {
  const store = openStore(':memory:')
  const a = clip(store, 'A')
  assert.equal(store.setRating([a], -1).rating, -1)
  assert.equal(store.asset(a).rating, -1)
  assert.throws(() => store.setRating([a], 3), /Bewertung/)
  assert.throws(() => store.createTag({ facet: 'quelle', name: 'Neu' }), /automatisch/)
  assert.throws(() => store.createTag({ facet: 'mode', name: 'latex' }), /schon/)
  store.close()
})
