import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from './core.mjs'
import * as hub from './host.mjs'
import { createHarness } from './test-harness.mjs'

test('Harness route persists clips, imports, projects and versioned storyboards', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-hub-'))
  const config = { databasePath: join(directory, 'hub.sqlite') }
  const harness = createHarness()
  t.after(() => {
    harness.unmountAll()
    rmSync(directory, { recursive: true, force: true })
  })
  const request = (method, path, body, site) => harness.request(method, '/creativity-hub' + path, body, site)
  const json = (method, path, body, status, site) => harness.json(method, '/creativity-hub/api' + path, body, status, site)
  const mount = () => { harness.mount(core, config); harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') }) }

  mount()
  assert.equal(harness.routes.get('/creativity-hub').auth, 'required')
  const page = await request('GET', '')
  assert.equal(page.status, 200)
  assert.match(String(page.result), /Atelier/)
  const project = await json('POST', '/projects', { title: 'Neues Konzept' }, 201)
  const clip = await json('POST', '/assets', {
    library: 'clips', title: 'Bühnenlicht', projectId: project.id, source: 'https://example.com/reference', description: 'Violette Reflexion',
  }, 201)
  await json('POST', '/assign', { id: clip.id, projectId: project.id })
  await json('POST', '/assign', { id: clip.id, projectId: project.id })
  const media = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII='
  const generated = await json('POST', '/assets', { library: 'generation', title: 'Entwurf', media, mediaType: 'image/png' }, 201)
  const preview = await request('GET', '/api/media/' + generated.id)
  assert.equal(preview.status, 200)
  assert.deepEqual(preview.result, Buffer.from(media, 'base64'))
  await json('POST', '/assets', { library: 'clips', title: 'Ungültig', source: 'javascript:1' }, 400)
  await json('POST', '/projects', { title: 'Nicht anlegen' }, 403, 'cross-site')
  const scene = { elements: [{ id: 'shape', type: 'rectangle' }], files: {} }
  const projectPath = '/projects/' + project.id
  await json('PUT', projectPath, { revision: 0, notes: 'Lichttest', scene })
  await json('PUT', projectPath, { revision: 0, notes: 'Veralteter Stand' }, 409)
  harness.unmountAll()
  mount()
  const saved = await json('GET', projectPath)
  assert.equal(saved.notes, 'Lichttest')
  assert.deepEqual(saved.scene, scene)
  const found = await json('GET', '/assets?project=' + project.id + '&q=violette')
  assert.deepEqual(found.map(item => item.id), [clip.id])
  assert.deepEqual((await json('GET', '/assets?library=generation')).map(item => item.id), [generated.id])
})

test('Ideas carry Kanban status and due date; journal, feed, todo and asset deletion', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-hub-'))
  const harness = createHarness()
  t.after(() => { harness.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  const json = (method, path, body, status, site) => harness.json(method, '/creativity-hub/api' + path, body, status, site)
  harness.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })

  const created = await json('POST', '/projects', { title: 'Shoot Rotlicht' }, 201)
  assert.equal(created.status, 'idee')
  assert.equal(created.due, '')
  const moved = await json('PUT', '/projects/' + created.id, { revision: created.revision, status: 'arbeit', due: '2026-12-03' })
  assert.equal(moved.status, 'arbeit')
  assert.equal((await json('GET', '/projects'))[0].due, '2026-12-03')
  await json('PUT', '/projects/' + created.id, { revision: moved.revision, status: 'unbekannt' }, 400)
  await json('PUT', '/projects/' + created.id, { revision: moved.revision, due: '3.12.' }, 400)

  await json('PUT', '/journal/2026-11-18', { text: 'Licht testen' })
  assert.deepEqual((await json('GET', '/journal')).map(entry => entry.text), ['Licht testen'])
  await json('PUT', '/journal/2026-11-18', { text: '' })
  assert.deepEqual(await json('GET', '/journal'), [])

  await json('PUT', '/todo', { items: [{ text: 'Gels bestellen', done: false }] })
  assert.equal((await json('GET', '/todo')).items[0].text, 'Gels bestellen')

  const media = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII='
  const upload = await json('POST', '/assets', { library: 'clips', title: 'Upload', media, mediaType: 'image/png', projectId: created.id }, 201)
  assert.deepEqual((await json('GET', '/feed')).map(entry => entry.kind).sort(), ['asset', 'idea'])
  await json('DELETE', '/assets/' + upload.id, undefined, 403, 'cross-site')
  await json('DELETE', '/assets/' + upload.id)
  assert.deepEqual(await json('GET', '/assets'), [])
  await json('DELETE', '/assets/' + upload.id, undefined, 404)
})

test('Editing a saved image updates its size and preserves project membership', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-media-'))
  const harness = createHarness()
  t.after(() => { harness.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  harness.mount(core, { databasePath: ':memory:' })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  const json = (method, path, body, status) => harness.json(method, '/creativity-hub/api' + path, body, status)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII=', 'base64')
  const bytes = Buffer.concat([png, Buffer.alloc(16)])
  const project = await json('POST', '/projects', { title: 'Ausschnitte' }, 201)
  const { id } = await json('POST', '/assets', { library: 'clips', title: 'Bild',
    projectId: project.id, media: bytes.toString('base64'), mediaType: 'image/png' }, 201)
  const [original] = await json('GET', '/assets?project=' + project.id)
  assert.equal(original.size, bytes.length)
  const tag = '"' + createHash('sha256').update(bytes).digest('hex') + '"'
  const path = '/assets/' + id + '/image-edit'
  const payload = { tag, action: 'reduce', media: png.toString('base64') }
  await json('POST', path, { ...payload, media: bytes.toString('base64') }, 422)
  const saved = await json('POST', path, payload)
  assert.deepEqual([saved.id, saved.title, saved.size], [id, original.title, png.length])
  await json('POST', path, payload, 409)
  assert.deepEqual(await json('GET', '/assets?project=' + project.id), [saved])
})

test('Collection tags are searchable and a bulk edit preserves unrelated per-clip tags', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'atelier-tags-'))
  const h = createHarness()
  t.after(() => { h.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  h.mount(core, { databasePath: ':memory:' })
  h.mount(hub, { launcherTokenPath: join(directory, 'token') })
  const json = (method, path, body, status) => h.json(method, '/creativity-hub/api' + path, body, status)
  const [person, location] = await Promise.all(['Test A', 'Test B'].map(title =>
    json('POST', '/assets', { library: 'clips', title, description: 'Eintrag' }, 201)))
  const store = h.ctx.creativeStore
  store.saveAutomaticTags(person.id, ['Person', 'Outfit'])
  store.saveAutomaticTags(location.id, ['Location'])
  assert.equal((await json('GET', '/assets?q=person'))[0].id, person.id)
  await json('POST', '/assets/tags', { ids: [person.id, location.id], add: ['Favorit'], remove: ['outfit'] })
  store.saveAutomaticTags(person.id, ['Nicht überschreiben'])
  assert.deepEqual(store.asset(person.id).tags, ['Person', 'Favorit'])
  assert.deepEqual(store.asset(location.id).tags, ['Location', 'Favorit'])
  await json('POST', '/assets/tags', { ids: [person.id, location.id], replace: ['Ein Tag'] }, 400)
  await json('POST', '/assets/tags', { ids: [person.id], replace: [] })
  store.saveAutomaticTags(person.id, ['Person'])
  assert.deepEqual(store.asset(person.id).tags, [])
  assert.equal(store.asset(person.id).tag_source, 'manual')
})

test('Tag and search routes expose vocabulary, human decisions and facet counts', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-hub-'))
  const harness = createHarness()
  t.after(() => { harness.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  const json = (method, path, body, status, site) => harness.json(method, '/creativity-hub/api' + path, body, status, site)
  harness.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  const clip = await json('POST', '/assets', { library: 'clips', title: 'Gummi Studio', description: 'rubber outfit' }, 201)
  const vocabulary = await json('GET', '/tags')
  assert.ok(vocabulary.find(facet => facet.id === 'mode').tags.some(tag => tag.id === 'mode:latex'))
  await json('POST', '/assets/tag-state', { assetIds: [clip.id], tagIds: ['mode:latex'], state: 'bestaetigt' })
  const found = await json('GET', '/search?q=' + encodeURIComponent('rubber'))
  assert.deepEqual(found.items.map(item => item.id), [clip.id])
  assert.deepEqual(found.facets.mode, [{ tagId: 'mode:latex', name: 'Latex', count: 1 }])
  assert.equal((await json('GET', '/assets?q=rubber')).length, 1)
  await json('POST', '/tags/mode%3Alatex/merge', { target: 'mode:outfit' })
  assert.equal((await json('GET', '/search?tags=mode:outfit')).total, 1)
  await json('POST', '/assets/rating', { ids: [clip.id], rating: -1 })
  assert.equal((await json('GET', '/search')).total, 0)
  assert.equal((await json('GET', '/search?rating=all')).total, 1)
  await json('POST', '/assets/rating', { ids: [clip.id], rating: 7 }, 400)
  await json('POST', '/tags', { facet: 'quelle', name: 'Eigene' }, 400)
  await json('POST', '/tags', { facet: 'frei', name: 'Eigene' }, 403, 'cross-site')
})

test('AI tagging runs only on request, validates the answer and saves suggestions', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-hub-'))
  const harness = createHarness()
  t.after(() => { harness.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  const json = (method, path, body, status) => harness.json(method, '/creativity-hub/api' + path, body, status)
  harness.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O5sAAAAASUVORK5CYII='
  const image = await json('POST', '/assets', { library: 'generation', title: 'Szene', media: png, mediaType: 'image/png' }, 201)
  await json('POST', '/assets/ai-tags', { ids: [image.id] }, 409)
  let calls = 0
  harness.ctx.creativeProviders.register({
    id: 'vision-text', title: 'Test', chatImages: true,
    chat(_, input) {
      calls++
      assert.equal(input.images.length, 1)
      return { text: '```json\n{"tags":{"mode":["Latex","Unbekannt"],"licht":["Neon"],"frei":["Regenmantel"]}}\n```', model: 'test-1' }
    },
  })
  assert.equal(calls, 0)
  const result = await json('POST', '/assets/ai-tags', { ids: [image.id] })
  assert.equal(calls, 1)
  assert.deepEqual(result.tagged, [{ id: image.id, added: 3 }])
  const tags = (await json('GET', '/assets/tags?ids=' + image.id))[image.id]
  assert.deepEqual(tags.filter(tag => tag.origin === 'ki').map(tag => `${tag.facet}:${tag.name}:${tag.state}`).sort(), ['frei:Regenmantel:vorschlag', 'licht:Neon:vorschlag', 'mode:Latex:vorschlag'])
  await json('POST', '/assets/ai-tags', { ids: [] }, 400)
})

test('saved searches persist and only accept hub routes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-hub-'))
  const harness = createHarness()
  t.after(() => { harness.unmountAll(); rmSync(directory, { recursive: true, force: true }) })
  const json = (method, path, body, status) => harness.json(method, '/creativity-hub/api' + path, body, status)
  harness.mount(core, { databasePath: join(directory, 'hub.sqlite') })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  assert.deepEqual(await json('GET', '/saved-searches'), [])
  const items = [{ id: 'a', name: 'Latex bei Nacht', href: '#/library?tags=mode%3Alatex,licht%3Anacht' }]
  await json('PUT', '/saved-searches', { items })
  assert.deepEqual(await json('GET', '/saved-searches'), items)
  await json('PUT', '/saved-searches', { items: [{ id: 'b', name: 'Böse', href: 'https://example.com' }] }, 400)
})
