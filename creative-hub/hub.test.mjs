import assert from 'node:assert/strict'
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
