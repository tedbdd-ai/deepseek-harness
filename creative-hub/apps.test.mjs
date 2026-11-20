import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as checklist from './apps/checklist/host.mjs'
import * as flows from './apps/flows/host.mjs'
import * as core from './core.mjs'
import * as hub from './host.mjs'
import { registerTools } from './mcp.mjs'
import { openStore } from './store.mjs'
import { createHarness } from './test-harness.mjs'

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-apps-'))
  const databasePath = join(directory, 'hub.sqlite')
  const harness = createHarness()
  t.after(() => {
    harness.unmountAll()
    rmSync(directory, { recursive: true, force: true })
  })
  harness.mount(core, { databasePath })
  harness.mount(hub, { launcherTokenPath: join(directory, 'launcher-token') })
  return { harness, databasePath }
}

test('App plugins register, serve their module and keep per-idea data', async t => {
  const { harness } = setup(t)
  const api = '/creativity-hub/api/'
  assert.deepEqual(await harness.json('GET', api + 'apps'), [])
  harness.mount(checklist)
  harness.mount(flows)
  const apps = await harness.json('GET', api + 'apps')
  assert.deepEqual(apps.map(app => app.id), ['checklist', 'flows'])
  const module = await harness.request('GET', apps[0].module)
  assert.equal(module.status, 200)
  assert.match(String(module.result), /export function render/)

  const idea = await harness.json('POST', api + 'projects', { title: 'Latex Lookbook', snapshot: 'fashion' }, 201)
  assert.deepEqual(idea.apps, ['flows', 'checklist'])
  await harness.json('POST', api + 'projects', { title: 'x', snapshot: 'nope' }, 400)

  const path = `projects/${idea.id}/apps/checklist`
  assert.deepEqual(await harness.json('GET', api + path), { data: {}, revision: 0 })
  const saved = await harness.json('PUT', api + path, { revision: 0, data: { items: [{ text: 'Latex 0,4 mm', done: false }] } })
  assert.equal(saved.revision, 1)
  await harness.json('PUT', api + path, { revision: 0, data: {} }, 409)
  await harness.json('PUT', api + path, { revision: 1, data: [] }, 400)

  const updated = await harness.json('PUT', api + 'projects/' + idea.id, { revision: idea.revision, apps: ['checklist', 'light-plan'], pinned: true })
  assert.deepEqual(updated.apps, ['checklist', 'light-plan'])
  await harness.json('PUT', api + 'projects/' + idea.id, { revision: updated.revision, apps: ['Bad Id'] }, 400)
  const [listed] = await harness.json('GET', api + 'projects')
  assert.equal(listed.pinned, true)

  const note = await harness.json('POST', api + 'assets', { library: 'clips', title: 'Gedanke', description: 'Spiegelnder Boden in VR' }, 201)
  await harness.json('POST', api + 'assign', { id: note.id, projectId: idea.id })
  assert.equal((await harness.json('GET', api + 'assets?project=' + idea.id)).length, 1)
  await harness.json('POST', api + 'unassign', { id: note.id, projectId: idea.id })
  assert.equal((await harness.json('GET', api + 'assets?project=' + idea.id)).length, 0)

  assert.equal((await harness.request('GET', '/creativity-apps/flows/other.js')).status, 404)
})

test('App registry rejects duplicates and invalid snapshots', () => {
  const registry = core.createAppRegistry([])
  const dispose = registry.register({ id: 'vr-scene', title: 'VR-Szene', icon: 'M0 0', module: '/creativity-apps/vr-scene/block.js' })
  assert.throws(() => registry.register({ id: 'vr-scene', title: 'x', icon: '', module: '/x' }), /bereits registriert/)
  assert.throws(() => registry.register({ id: 'x', title: 'x', icon: '', module: 'https://example.com/x.js' }), /lokalen Pfad/)
  dispose()
  assert.deepEqual(registry.apps(), [])
  assert.throws(() => core.createAppRegistry([{ id: 'Bad', title: 'x', apps: [] }]), /Ungültiger Snapshot/)
})

test('MCP tools work on the same ideas and app data as the hub', async t => {
  const { harness, databasePath } = setup(t)
  const store = openStore(databasePath)
  t.after(() => store.close())
  const server = new McpServer({ name: 'creativity-hub', version: 'test' })
  registerTools(server, store)
  const client = new Client({ name: 'test', version: 'test' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args })
    return { error: result.isError === true, value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) }
  }

  const idea = (await call('create_idea', { title: 'Acid-Set Spiegelsaal', snapshot: 'music' })).value
  assert.deepEqual(idea.apps, ['patch-sheet', 'checklist', 'flows'])
  await call('set_app_data', { id: idea.id, app: 'patch-sheet', revision: 0, data: { rows: [{ device: 'Korg phase8', patch: '12', notes: '' }] } })
  const fromHub = await harness.json('GET', `/creativity-hub/api/projects/${idea.id}/apps/patch-sheet`)
  assert.equal(fromHub.data.rows[0].device, 'Korg phase8')
  const full = (await call('get_idea', { id: idea.id })).value
  assert.equal(full.appData['patch-sheet'].revision, 1)
  const stale = await call('update_idea', { id: idea.id, revision: 5, notes: 'alt' })
  assert.equal(stale.error, true)
  assert.match(stale.value, /zwischenzeitlich geändert/)
  await call('add_inspiration', { title: 'Acid-Referenz', source: 'https://example.com/acid', ideaId: idea.id })
  assert.equal((await call('search_assets', { ideaId: idea.id })).value.length, 1)
})
