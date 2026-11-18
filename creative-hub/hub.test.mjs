import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { apply } from './host.mjs'

test('Harness route persists clips, imports, projects and versioned storyboards', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'creativity-hub-'))
  let route
  let dispose
  const config = { databasePath: join(directory, 'hub.sqlite') }
  const ctx = {
    webServer: { register(entry) { route = entry; return () => { route = undefined } } },
    effect(register) { dispose = register() },
    on() {},
  }
  t.after(() => {
    dispose?.()
    rmSync(directory, { recursive: true, force: true })
  })
  async function request(method, path, body, site = 'same-origin') {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    Object.assign(request, {
      method,
      url: '/creativity-hub' + path,
      headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
    })
    let status
    let result
    await route.handler(request, {
      setHeader() {},
      writeHead(code) { status = code },
      end(data) { result = data },
    })
    return { status, result }
  }
  async function json(method, path, body, status = 200, site) {
    const response = await request(method, '/api' + path, body, site)
    assert.equal(response.status, status, String(response.result))
    return JSON.parse(response.result)
  }

  apply(ctx, config)
  assert.equal(route.auth, 'required')
  const page = await request('GET', '')
  assert.equal(page.status, 200)
  assert.match(String(page.result), /Generation Library/)
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
  dispose()
  apply(ctx, config)
  const saved = await json('GET', projectPath)
  assert.equal(saved.notes, 'Lichttest')
  assert.deepEqual(saved.scene, scene)
  const found = await json('GET', '/assets?project=' + project.id + '&q=violette')
  assert.deepEqual(found.map(item => item.id), [clip.id])
  assert.deepEqual((await json('GET', '/assets?library=generation')).map(item => item.id), [generated.id])
})
