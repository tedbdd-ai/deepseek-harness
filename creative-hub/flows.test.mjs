import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as core from './core.mjs'
import { createNodeRegistry } from './core.mjs'
import * as flows from './apps/flows/host.mjs'
import { createEngine } from './apps/flows/lib/engine.mjs'
import { videoNode } from './apps/influencer-video/host.mjs'
import { composeClips } from './apps/schnitt/export.mjs'
import { imageNode } from './playground/host.mjs'
import { openStore } from './store.mjs'
import { createHarness } from './test-harness.mjs'

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('Zeitüberschreitung')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** Store, registry with the source nodes and two test nodes: `upper` (paid, text → text) and `fail`. */
function setup() {
  const store = openStore(':memory:')
  const registry = createNodeRegistry()
  for (const node of flows.sourceNodes(store)) registry.register(node)
  const calls = []
  registry.register({ type: 'upper', title: 'Groß', group: 'text', icon: 'text', paid: true, prompt: true,
    inputs: [{ id: 'text', kind: 'text', label: 'Text', multiple: true, required: true }], outputs: [{ id: 'text', kind: 'text', label: 'Text' }],
    run: async ({ inputs, prompt }) => { calls.push(inputs.text); return { outputs: { text: [inputs.text.join(' ').toUpperCase() + prompt] }, credits: 2 } } })
  registry.register({ type: 'fail', title: 'Kaputt', group: 'text', icon: 'text',
    inputs: [{ id: 'text', kind: 'text', label: 'Text' }], outputs: [{ id: 'text', kind: 'text', label: 'Text' }],
    run: async () => { throw new Error('geheimer Stacktrace') } })
  const project = store.createProject({ title: 'Kurzfilm' })
  const save = data => store.setAppData(project.id, 'flow', { revision: store.appData(project.id, 'flow').revision, data })
  return { store, registry, project: project.id, save, calls }
}
const edge = (source, sourceHandle, target, targetHandle) => ({ id: source + target + targetHandle, source, sourceHandle, target, targetHandle })

test('the node registry checks node types and returns a disposer', () => {
  const registry = createNodeRegistry()
  const base = { type: 'probe', title: 'Probe', group: 'text', icon: 'text', inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Text' }], resolve: () => ({}) }
  assert.throws(() => registry.register({ ...base, outputs: [{ id: 'x', kind: 'pdf', label: 'X' }] }), /Ports/)
  assert.throws(() => registry.register({ ...base, run: async () => ({}) }), /genau eines/)
  const dispose = registry.register(base)
  assert.throws(() => registry.register(base), /bereits/)
  dispose()
  assert.equal(registry.node('probe'), undefined)
})

test('a run passes values along edges, ordered top to bottom, and marks results stale when inputs change', async () => {
  const { store, registry, project, save, calls } = setup()
  const engine = createEngine(store, registry)
  save({ nodes: [
    { id: 'b', type: 'text', x: 0, y: 200, prompt: 'zwei' },
    { id: 'a', type: 'text', x: 0, y: 0, prompt: 'eins' },
    { id: 'u', type: 'upper', x: 400, y: 0, prompt: '!' },
    { id: 'v', type: 'upper', x: 800, y: 0, prompt: '' },
  ], edges: [edge('b', 'text', 'u', 'text'), edge('a', 'text', 'u', 'text'), edge('u', 'text', 'v', 'text')] })
  assert.deepEqual(engine.plan(project, 'v', 'upstream').map(step => step.id), ['u', 'v'])
  const steps = engine.run(project, 'u', 'downstream')
  assert.deepEqual(steps.map(step => [step.id, step.paid]), [['u', true], ['v', true]])
  await until(() => engine.view(project).v.status === 'done')
  const view = engine.view(project)
  assert.deepEqual(calls[0], ['eins', 'zwei'])
  assert.deepEqual(view.u.outputs.text, ['EINS ZWEI!'])
  assert.deepEqual(view.v.outputs.text, ['EINS ZWEI!'])
  assert.equal(view.u.credits, 2)
  assert.equal(view.a.status, 'source')
  assert.equal(view.v.stale, false)
  assert.deepEqual(engine.plan(project, 'v', 'upstream').map(step => step.id), ['v'])

  save({ ...store.appData(project, 'flow').data, nodes: store.appData(project, 'flow').data.nodes.map(node => node.id === 'a' ? { ...node, prompt: 'drei' } : node) })
  assert.equal(engine.view(project).u.stale, true)
  assert.equal(engine.view(project).v.stale, false, 'v rechnet mit dem letzten Ergebnis von u weiter')
  assert.deepEqual(engine.plan(project, 'v', 'upstream').map(step => step.id), ['u', 'v'])
  engine.run(project, 'u', 'node')
  await until(() => engine.view(project).u.status === 'done' && !engine.view(project).u.stale)
  assert.equal(engine.view(project).v.stale, true)
  assert.equal(engine.view(project).u.history.length, 2)
  engine.pick(project, 'u', 1)
  assert.deepEqual(engine.view(project).u.outputs.text, ['EINS ZWEI!'])
  assert.equal(engine.view(project).u.stale, true)
  store.close()
})

test('failures stay on their node, stop the nodes after it and never show internal errors', async () => {
  const { store, registry, project, save } = setup()
  const engine = createEngine(store, registry)
  save({ nodes: [{ id: 'f', type: 'fail', x: 0, y: 0 }, { id: 'u', type: 'upper', x: 400, y: 0 }, { id: 'e', type: 'upper', x: 400, y: 300 }],
    edges: [edge('f', 'text', 'u', 'text')] })
  const logged = console.error
  console.error = () => {}
  try {
    engine.run(project, 'f', 'downstream')
    await until(() => engine.view(project).u.status === 'failed')
  } finally { console.error = logged }
  assert.equal(engine.view(project).f.error, 'Der Knoten konnte nicht ausgeführt werden.')
  assert.match(engine.view(project).u.error, /Schritt davor/)
  engine.run(project, 'e', 'node')
  await until(() => engine.view(project).e.status === 'failed')
  assert.equal(engine.view(project).e.error, 'Verbinde den Eingang „Text“.')
  engine.run(project, 'u', 'node')
  await until(() => engine.view(project).u.status === 'failed' && /Führe zuerst/.test(engine.view(project).u.error))
  assert.equal(engine.view(project).u.error, 'Führe zuerst „Kaputt“ aus.')
  store.close()
})

test('a cycle, a running node and source nodes cannot be run', async () => {
  const { store, registry, project, save } = setup()
  const engine = createEngine(store, registry)
  save({ nodes: [{ id: 'u', type: 'upper', x: 0, y: 0 }, { id: 'v', type: 'upper', x: 0, y: 0 }, { id: 't', type: 'text', x: 0, y: 0, prompt: 'x' }],
    edges: [edge('u', 'text', 'v', 'text'), edge('v', 'text', 'u', 'text')] })
  assert.throws(() => engine.plan(project, 'u', 'node'), /Kreis/)
  assert.throws(() => engine.plan(project, 't', 'node'), /ohne Ausführen/)
  assert.throws(() => engine.plan(project, 'nope', 'node'), /gespeicherten Flow/)
  save({ nodes: [{ id: 't', type: 'text', x: 0, y: 0, prompt: 'x' }, { id: 'u', type: 'upper', x: 0, y: 0 }], edges: [edge('t', 'text', 'u', 'text')] })
  engine.run(project, 'u', 'node')
  assert.throws(() => engine.run(project, 'u', 'node'), /läuft noch/)
  await until(() => engine.view(project).u.status === 'done')
  store.close()
})

test('a node that was running when the hub stopped shows that it was interrupted', () => {
  const { store, registry, project, save } = setup()
  save({ nodes: [{ id: 'u', type: 'upper', x: 0, y: 0 }], edges: [] })
  store.setSettings('flows:state:' + project, { u: { status: 'running', startedAt: new Date().toISOString() } })
  const view = createEngine(store, registry).view(project)
  assert.equal(view.u.status, 'failed')
  assert.match(view.u.error, /Unterbrochen/)
  store.close()
})

test('source nodes read the Library, the moodboard and storyboard shots', () => {
  const { store, registry, project, save } = setup()
  const image = store.createAsset({ library: 'clips', title: 'Gesicht', mediaType: 'image/png', media: png.toString('base64'), projectId: project }).id
  const note = store.createAsset({ library: 'clips', title: 'Notiz', description: 'nur Text' }).id
  store.setAppData(project, 'moodboard', { revision: 0, data: { items: [{ id: image }, { id: note }, { id: 'weg' }] } })
  store.setAppData(project, 'storyboard', { revision: 0, data: { shots: [{ id: 's1', title: 'Auftritt', prompt: 'Sie betritt den Raum', ref: image }] } })
  save({ nodes: [
    { id: 'l', type: 'library', x: 0, y: 0, params: { assetIds: [image, note] } },
    { id: 'm', type: 'moodboard', x: 0, y: 0 },
    { id: 's', type: 'shot', x: 0, y: 0, params: { shotId: 's1' } },
    { id: 'x', type: 'unbekannt', x: 0, y: 0 },
  ], edges: [] })
  const view = createEngine(store, registry).view(project)
  assert.deepEqual(view.l.outputs, { image: [image], video: [], audio: [] })
  assert.deepEqual(view.m.outputs.image, [image])
  assert.deepEqual(view.s.outputs, { text: ['Sie betritt den Raum'], image: [image] })
  assert.equal(view.x.status, 'unknown')
  store.close()
})

test('the Flows routes list node types, return the state with its assets and refuse cross-site runs', async () => {
  const harness = createHarness()
  harness.mount(core, { databasePath: ':memory:' })
  harness.mount(flows)
  const store = harness.ctx.creativeStore
  const project = store.createProject({ title: 'Clip' }).id
  const image = store.createAsset({ library: 'clips', title: 'Bild', mediaType: 'image/png', media: png.toString('base64') }).id
  store.setAppData(project, 'flow', { revision: 0, data: { nodes: [{ id: 'l', type: 'library', x: 0, y: 0, params: { assetIds: [image] } }], edges: [] } })
  const types = await harness.json('GET', '/creativity-flows/api/nodes')
  assert.deepEqual(types.map(type => type.type), ['text', 'library', 'moodboard', 'shot'])
  assert.deepEqual(types.find(type => type.type === 'library').fields, [{ key: 'assetIds', label: 'Dateien', type: 'assets' }])
  const state = await harness.json('GET', `/creativity-flows/api/projects/${project}/state`)
  assert.equal(state.assets[image].title, 'Bild')
  assert.equal((await harness.request('POST', `/creativity-flows/api/projects/${project}/run`, { nodeId: 'l' }, 'cross-site')).status, 403)
  const refused = await harness.request('POST', `/creativity-flows/api/projects/${project}/run`, { nodeId: 'l', dryRun: true })
  assert.equal(refused.status, 400)
  assert.match(JSON.parse(refused.result).error, /ohne Ausführen/)
  harness.unmountAll()
  assert.equal(harness.ctx.creativeNodes, undefined)
})

test('the image node runs one Playground job with the joined prompt and the connected references', async () => {
  const started = []
  const playground = {
    models: () => [{ id: 'm1', title: 'Nano', variants: { text: { fields: [{ key: 'aspect_ratio', label: 'Format', type: 'enum', options: ['1:1', '16:9'] }, { key: 'prompt', type: 'prompt' }] } } }],
    start: async body => { started.push(body); return { id: 'r1' } },
    settle: async () => ({ results: [{ status: 'done', assetIds: ['a1', 'a2'], credits: 3 }, { status: 'failed', error: 'x' }] }),
  }
  const node = imageNode(playground)
  const fields = await node.fields()
  assert.deepEqual(fields.map(field => [field.key, field.model ?? null]), [['modelId', null], ['count', null], ['aspect_ratio', 'm1']])
  const result = await node.run({ inputs: { prompt: ['Eine Frau im Regen'], refs: ['ref1'] }, prompt: 'Nahaufnahme', params: { modelId: 'm1', count: '2', settings: { m1: { aspect_ratio: '16:9' } } }, projectId: 'p', stopped: () => false })
  assert.deepEqual(result, { outputs: { image: ['a1', 'a2'] }, credits: 3 })
  assert.equal(started[0].prompt, 'Eine Frau im Regen\n\nNahaufnahme')
  assert.deepEqual(started[0].referenceIds, ['ref1'])
  assert.deepEqual(started[0].modelParams, { m1: { aspect_ratio: '16:9' } })
  assert.equal(started[0].count, 2)
  playground.settle = async () => ({ results: [{ status: 'failed', error: 'Der Anbieter hat den Prompt abgelehnt.' }] })
  await assert.rejects(node.run({ inputs: { prompt: [], refs: [] }, prompt: 'x', params: {}, projectId: 'p', stopped: () => false }), /abgelehnt/)
})

test('the video node picks the Seedance mode from its connections and waits for the provider', async () => {
  const bodies = []
  let checks = 0
  const providers = { list: async () => [{ id: 'kie', capabilities: ['startVideo'] }] }
  const node = videoNode({
    providers, stopped: () => false, every: 0,
    start: async body => { bodies.push(body); return { id: body.requestId, status: 'queued' } },
    refresh: async id => (++checks < 2 ? { id, status: 'queued' } : { id, status: 'done', assetId: 'v1', frameId: 'f1', credits: 40 }),
  })
  const empty = { prompt: [], start: [], end: [], images: [], videos: [], audio: [] }
  const run = (inputs, params = {}) => node.run({ inputs: { ...empty, ...inputs }, params, prompt: 'Sie dreht sich um', projectId: 'p', stopped: () => false })
  assert.deepEqual(await run({ start: ['i1'], end: ['i2'] }, { settings: { seedance: { duration: '8', lastFrame: true } } }), { outputs: { video: ['v1'], frame: ['f1'] }, credits: 40 })
  assert.equal(bodies[0].mode, 'frames')
  assert.equal(bodies[0].settings.duration, 8)
  assert.equal(bodies[0].settings.lastFrame, true)
  await run({ images: ['i1'], audio: ['s1'] })
  assert.equal(bodies[1].mode, 'references')
  assert.deepEqual(bodies[1].referenceIds, { image: ['i1'], video: [], audio: ['s1'] })
  await run({})
  assert.equal(bodies[2].mode, 'text')
  await assert.rejects(run({ start: ['i1'], images: ['i2'] }), /entweder/)
  await assert.rejects(run({}, { modelId: 'kling' }), /Startbild/)
  await run({ start: ['i1'] }, { modelId: 'kling', settings: { kling: { duration: '10' } } })
  assert.deepEqual([bodies[3].model, bodies[3].mode, bodies[3].duration], ['kling', 'keyframe', '10'])
  const failing = videoNode({ providers, stopped: () => false, every: 0, start: async () => ({ id: 'x', status: 'unknown', error: 'Einreichung unklar.' }), refresh: async () => ({}) })
  await assert.rejects(failing.run({ inputs: empty, params: {}, prompt: 'x', projectId: 'p', stopped: () => false }), /Einreichung unklar/)
})

test('the composition joins whole clips in order and keeps them in the project', { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flows-'))
  try {
    const clip = join(dir, 'c.mp4')
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=24', '-pix_fmt', 'yuv420p', clip])
    const store = openStore(':memory:')
    const project = store.createProject({ title: 'Teaser' })
    const { id } = store.createAsset({ library: 'generation', title: 'Clip', mediaType: 'video/mp4', media: readFileSync(clip).toString('base64') })
    const result = await composeClips(store, project.id, [id, id], [])
    assert.equal(Math.round(result.seconds), 4)
    assert.equal(store.asset(result.id).title, 'Komposition · Teaser')
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
