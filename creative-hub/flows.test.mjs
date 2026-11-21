import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as core from './core.mjs'
import { createNodeRegistry } from './core.mjs'
import * as flows from './apps/flows/host.mjs'
import { createEngine, readingOrder } from './apps/flows/engine/engine.mjs'
import { videoNode } from './apps/influencer-video/host.mjs'
import { blackVideo, composeClips } from './apps/schnitt/export.mjs'
import * as playgroundPlugin from './playground/host.mjs'
import { imageNode } from './playground/host.mjs'
import * as videoPlugin from './apps/influencer-video/host.mjs'
import * as schnittPlugin from './apps/schnitt/host.mjs'
import * as llmPlugin from './nodes/llm/host.mjs'
import { templates } from './apps/flows/engine/templates.mjs'
import { absolute, adoptIntoFrames } from './apps/flows/engine/frames.mjs'
import { directorNode, llmNode, moodboardNode, parseJson, styleNode } from './nodes/llm/host.mjs'
import { implicitEdges } from './apps/flows/engine/mentions.mjs'
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

test('several nodes run as one joined plan, each step once and in line order', async () => {
  const { store, registry, project, save } = setup()
  save({ nodes: [
    { id: 'a', type: 'text', x: 0, y: 0, prompt: 'a' },
    { id: 'eins', type: 'upper', name: 'Eins', x: 300, y: 0 },
    { id: 'zwei', type: 'upper', name: 'Zwei', x: 600, y: 0 },
    { id: 'drei', type: 'upper', name: 'Drei', x: 600, y: 300 },
  ], edges: [edge('a', 'text', 'eins', 'text'), edge('eins', 'text', 'zwei', 'text'), edge('eins', 'text', 'drei', 'text')] })
  const engine = createEngine(store, registry)
  assert.deepEqual(engine.plan(project, ['drei', 'zwei'], 'upstream').map(step => [step.id, step.name]), [['eins', 'Eins'], ['drei', 'Drei'], ['zwei', 'Zwei']])
  assert.throws(() => engine.plan(project, [], 'node'), /mindestens einen Knoten/)
  engine.run(project, ['zwei', 'drei'], 'upstream')
  await until(() => engine.view(project).zwei.status === 'done' && engine.view(project).drei.status === 'done')
  assert.deepEqual(engine.view(project).drei.outputs.text, ['A'])
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

test('board nodes give their values, frames pass on what lies inside in reading order', () => {
  const { store, registry, project, save } = setup()
  const image = store.createAsset({ library: 'clips', title: 'Gesicht', mediaType: 'image/png', media: png.toString('base64'), projectId: project }).id
  const second = store.createAsset({ library: 'clips', title: 'Mantel', mediaType: 'image/png', media: png.toString('base64') }).id
  const note = store.createAsset({ library: 'clips', title: 'Notiz', description: 'nur Text' }).id
  save({ nodes: [
    { id: 'f', type: 'frame', name: 'Moodboard', x: 0, y: 0, params: { width: 1000, height: 400 } },
    { id: 'l2', type: 'library', x: 600, y: 40, params: { assetIds: [second] } },
    { id: 'l1', type: 'library', x: 40, y: 60, params: { assetIds: [image, note, 'weg'] } },
    { id: 'c', type: 'color', x: 300, y: 50, params: { color: '#a0b0c0' } },
    { id: 'out', type: 'library', x: 1200, y: 0, params: { assetIds: [second] } },
    { id: 's', type: 'scene', x: 0, y: 600, prompt: ' Sie betritt den Raum ', params: { assetIds: [image], duration: '8' } },
    { id: 'k', type: 'link', x: 0, y: 900, params: { url: 'javascript:alert(1)' } },
    { id: 'x', type: 'unbekannt', x: 0, y: 0 },
  ], edges: [] })
  const view = createEngine(store, registry).view(project)
  assert.deepEqual(view.l1.outputs, { image: [image], video: [], audio: [] })
  assert.deepEqual(view.f.outputs, { text: ['Farbe #A0B0C0'], image: [image, second], video: [], audio: [] })
  assert.deepEqual(view.s.outputs, { text: ['Sie betritt den Raum'], image: [image] })
  assert.deepEqual(view.k.outputs, { text: [] })
  assert.equal(view.x.status, 'unknown')
  store.close()
})

test('@ mentions of connected nodes become the reference marks of the receiving node', async () => {
  const { store, registry, project, save } = setup()
  const seen = []
  registry.register({ type: 'probe', title: 'Probe', group: 'image', icon: 'image', prompt: true,
    inputs: [{ id: 'prompt', kind: 'text', label: 'Prompt', multiple: true }, { id: 'refs', kind: 'image', label: 'Referenzen', multiple: true, mark: 'Bild' }],
    outputs: [{ id: 'image', kind: 'image', label: 'Bild' }],
    run: async ({ inputs, prompt }) => { seen.push([inputs.prompt, prompt]); return { outputs: { image: inputs.refs } } } })
  const a = store.createAsset({ library: 'clips', title: 'A', mediaType: 'image/png', media: png.toString('base64') }).id
  const b = store.createAsset({ library: 'clips', title: 'B', mediaType: 'image/png', media: png.toString('base64') }).id
  save({ nodes: [
    { id: 'set', type: 'library', name: 'Set', x: 400, y: 0, params: { assetIds: [b] } },
    { id: 'figur', type: 'library', name: 'Charakter', x: 0, y: 0, params: { assetIds: [a] } },
    { id: 'idee', type: 'text', x: 0, y: 300, prompt: '@Charakter steht vor @set.' },
    { id: 'p', type: 'probe', x: 800, y: 0, prompt: '@Charakter lacht' },
    { id: 'stimme', type: 'library', name: 'Stimme', x: 0, y: 600, params: { assetIds: [] } },
  ], edges: [edge('figur', 'image', 'p', 'refs'), edge('set', 'image', 'p', 'refs'), edge('idee', 'text', 'p', 'prompt')] })
  const engine = createEngine(store, registry)
  assert.deepEqual(engine.view(project).p.refs.map(ref => [ref.mark, ref.name]), [['@Bild1', 'Charakter'], ['@Bild2', 'Set']])
  engine.run(project, 'p')
  await until(() => engine.view(project).p.status === 'done')
  assert.deepEqual(seen[0], [['@Bild1 steht vor @Bild2.'], '@Bild1 lacht'])
  assert.deepEqual(engine.view(project).idee.outputs.text, ['@Charakter steht vor @set.'], 'die Notiz selbst bleibt unverändert')
  save({ ...store.appData(project, 'flow').data, nodes: store.appData(project, 'flow').data.nodes.map(node => node.id === 'p' ? { ...node, prompt: 'mit @Stimme' } : node) })
  engine.run(project, 'p')
  await until(() => engine.view(project).p.status === 'failed')
  assert.match(engine.view(project).p.error, /„Stimme“ ist nicht mit diesem Knoten verbunden/)
  store.close()
})

test('reading order follows rows left to right and columns top to bottom', () => {
  assert.deepEqual(readingOrder([{ x: 600, y: 10 }, { x: 0, y: 40 }, { x: 300, y: 0 }]).map(node => node.x), [0, 300, 600])
  assert.deepEqual(readingOrder([{ x: 10, y: 600 }, { x: 0, y: 0 }, { x: 40, y: 300 }]).map(node => node.y), [0, 300, 600])
})

test('the former Moodboard and Storyboard become a document with frames and stay stored', async () => {
  const harness = createHarness()
  harness.mount(core, { databasePath: ':memory:' })
  harness.mount(flows)
  const store = harness.ctx.creativeStore
  const project = store.createProject({ title: 'Musikvideo' }).id
  const image = store.createAsset({ library: 'clips', title: 'Look', mediaType: 'image/png', media: png.toString('base64') }).id
  store.setAppData(project, 'moodboard', { revision: 0, data: { items: [{ id: image }], positions: { [image]: { x: 500, y: 200 } },
    cards: [{ id: 'n', type: 'note', title: 'Ton', text: 'kühl' }, { id: 'c', type: 'color', title: 'Rot', color: '#aa0000' }] } })
  store.setAppData(project, 'storyboard', { revision: 0, data: { story: 'Sie sucht ihn.', shots: [{ id: 's1', title: 'Auftritt', prompt: 'Tür geht auf', duration: 6, ref: image }] } })
  assert.deepEqual(await harness.json('GET', `/creativity-flows/api/projects/${project}/import-boards`), { nodes: 7 })
  const made = await harness.json('POST', `/creativity-flows/api/projects/${project}/import-boards`, {}, 201)
  assert.deepEqual(made.docs.map(doc => [doc.kind, doc.title]), [['flow', 'Übernommene Boards']])
  const saved = store.appData(project, 'flow-' + made.docs[0].id)
  const types = saved.data.nodes.map(node => node.type)
  assert.deepEqual(types.sort(), ['color', 'frame', 'frame', 'library', 'scene', 'text', 'text'])
  const scene = saved.data.nodes.find(node => node.type === 'scene')
  assert.deepEqual([scene.name, scene.prompt, scene.params], ['Auftritt', 'Tür geht auf', { duration: '6', assetIds: [image] }])
  const state = await harness.json('GET', `/creativity-flows/api/projects/${project}/documents/${made.docs[0].id}/state`)
  const frames = saved.data.nodes.filter(node => node.type === 'frame')
  assert.deepEqual(state.nodes[frames[0].id].outputs.image, [image])
  assert.equal(store.appData(project, 'moodboard').revision, 1)
  harness.unmountAll()
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
  assert.deepEqual(types.map(type => type.type), ['text', 'library', 'scene', 'color', 'link', 'frame'])
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

test('the composition joins whole clips in order and sound becomes a black video', { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flows-'))
  try {
    const clip = join(dir, 'c.mp4')
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=24', '-pix_fmt', 'yuv420p', clip])
    const store = openStore(':memory:')
    const project = store.createProject({ title: 'Teaser' })
    const { id } = store.createAsset({ library: 'generation', title: 'Clip', mediaType: 'video/mp4', media: readFileSync(clip).toString('base64') })
    const result = await composeClips(store, project.id, [id, id], [])
    assert.ok(Math.abs(result.seconds - 4) < 1, `Länge ${result.seconds}`)
    assert.equal(store.asset(result.id).title, 'Komposition · Teaser')
    const tone = join(dir, 't.mp3')
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', tone])
    const voice = store.createAsset({ library: 'clips', title: 'Stimme', mediaType: 'audio/mpeg', media: readFileSync(tone).toString('base64') }).id
    const black = await blackVideo(store, project.id, voice)
    assert.ok(Math.abs(black.seconds - 2) < 0.15, `Länge ${black.seconds}`)
    assert.equal(store.asset(black.id).title, 'Schwarzes Video · Stimme')
    assert.equal(store.media(black.id).media_type, 'video/mp4')
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the LLM node sends text and labelled files to the chosen chat model', async () => {
  const store = openStore(':memory:')
  const image = store.createAsset({ library: 'clips', title: 'Gesicht', mediaType: 'image/png', media: png.toString('base64') }).id
  const voice = store.createAsset({ library: 'clips', title: 'Stimme', mediaType: 'audio/mpeg', media: Buffer.from('ID3fake').toString('base64') }).id
  const calls = []
  const listed = [{ id: 'litellm', title: 'LiteLLM', capabilities: ['chat', 'models'], chatImages: true, chatFiles: true, secrets: [{ configured: true }] },
    { id: 'abliteration', title: 'Abliteration', capabilities: ['chat'], chatImages: false, chatFiles: false, secrets: [{ configured: true }] }]
  const providers = {
    list: async () => listed,
    call: async (id, action, input) => {
      if (action === 'models') return [{ id: 'gemini-flash', title: 'gemini-flash' }, { id: 'nano-banana', title: 'nano-banana' }]
      calls.push([id, input]); return { text: '00:03.00 Hallo', model: 'gemini-flash' }
    },
  }
  const node = llmNode(providers, store)
  const [field] = await node.fields()
  assert.deepEqual(field.options.map(option => option.value), ['litellm', 'litellm:gemini-flash', 'abliteration'])
  assert.deepEqual(field.options[0].tags, ['LiteLLM', 'Bilder', 'Video und Ton'])
  const empty = { prompt: [], images: [], videos: [], audio: [] }
  const result = await node.run({ inputs: { ...empty, prompt: ['Transkribiere @Audio1'], images: [image], audio: [voice] }, params: { modelId: 'litellm:gemini-flash' }, prompt: 'Plus 3 Sekunden Versatz.' })
  assert.deepEqual(result.outputs, { text: ['00:03.00 Hallo'] })
  assert.equal(calls[0][1].model, 'gemini-flash')
  assert.equal(calls[0][1].prompt, 'Transkribiere @Audio1\n\nPlus 3 Sekunden Versatz.')
  assert.deepEqual(calls[0][1].images.map(file => [file.referenceLabel, file.mediaType]), [['@Bild1', 'image/png'], ['@Audio1', 'audio/mpeg']])
  await assert.rejects(node.run({ inputs: { ...empty, audio: [voice] }, params: { modelId: 'abliteration' }, prompt: 'x' }), /liest keine Videos oder Tondateien/)
  await assert.rejects(node.run({ inputs: empty, params: {}, prompt: ' ' }), /Anweisung/)
  store.close()
})

test('the Charakterblatt builds the reference sheet prompt and the Set keeps people out', async () => {
  const started = []
  const playground = {
    models: () => [{ id: 'm1', title: 'Nano', providerTitle: 'LiteLLM', variants: { text: { fields: [] }, edit: { fields: [] } } }],
    start: async body => { started.push(body); return { id: 'r' } },
    settle: async () => ({ results: [{ status: 'done', assetIds: ['a'] }] }),
  }
  const sheet = imageNode(playground, 'character')
  const fields = await sheet.fields()
  assert.deepEqual(fields[0].options[0].tags, ['LiteLLM', 'Bearbeiten', 'Text zu Bild'])
  assert.ok(fields.some(field => field.key === 'outfit' && field.type === 'longtext'))
  await sheet.run({ inputs: { prompt: [], refs: ['f'] }, prompt: 'Frau, 30, Narbe über @Bild1', params: { outfit: 'Schwarzer Latexmantel', head: 'back' }, projectId: 'p', stopped: () => false })
  assert.match(started[0].prompt, /^4-panel character reference sheet in front of a neutral mid-gray studio background/)
  assert.match(started[0].prompt, /panel 4 shows the back of the head/)
  assert.match(started[0].prompt, /Character: Frau, 30, Narbe über @Bild1 Mouth slightly open/)
  assert.match(started[0].prompt, /Outfit: Schwarzer Latexmantel/)
  assert.equal(started[0].title, 'Charakterblatt · Frau, 30, Narbe über @Bild1')
  await assert.rejects(sheet.run({ inputs: { prompt: [], refs: [] }, prompt: '', params: {}, projectId: 'p', stopped: () => false }), /Beschreibe die Figur/)
  await imageNode(playground, 'set').run({ inputs: { prompt: [], refs: [] }, prompt: 'Verlassener Klinikflur', params: {}, projectId: 'p', stopped: () => false })
  assert.match(started[1].prompt, /^Verlassener Klinikflur\nThe set is empty: no people/)
})

test('the video node warns about a start frame next to sound and about a clip shorter than its voice', () => {
  const node = videoNode({ start: async () => ({}), refresh: async () => ({}), providers: { list: async () => [] }, stopped: () => false, duration: id => (id === 'ton' ? 17.6 : null) })
  const empty = { prompt: [], start: [], end: [], images: [], videos: [], audio: [] }
  const [first, second] = node.check({ inputs: { ...empty, start: ['bild'], audio: ['ton'] }, params: { settings: { seedance: { duration: '10' } } } })
  assert.match(first, /nur ohne Startbild/)
  assert.match(second, /10 s lang, die Tonspur 17,6 s\. Stell mindestens 20 s ein/)
  assert.deepEqual(node.check({ inputs: { ...empty, images: ['bild'], videos: ['ton'] }, params: { settings: { seedance: { duration: '20' } } } }), [])
  assert.deepEqual(node.check({ inputs: { ...empty, start: ['bild'], audio: ['ton'] }, params: { modelId: 'kling' } }), [])
})

test('every template creates new documents that fit the node types, reach each other through @assets and fill their moodboard', async () => {
  const harness = createHarness()
  harness.mount(core, { databasePath: ':memory:' })
  for (const plugin of [flows, playgroundPlugin, videoPlugin, schnittPlugin, llmPlugin]) harness.mount(plugin)
  const registry = harness.ctx.creativeNodes
  for (const template of templates) {
    const docs = template.docs()
    const all = docs.flatMap(doc => doc.nodes)
    for (const { nodes, edges } of docs) {
      const byKey = new Map(nodes.map(node => [node.key, node]))
      for (const node of nodes) assert.ok(registry.node(node.type), `${template.id}: ${node.type} fehlt`)
      for (const edge of edges) {
        const out = registry.node(byKey.get(edge.source).type).outputs.find(port => port.id === edge.sourceHandle)
        const into = registry.node(byKey.get(edge.target).type).inputs.find(port => port.id === edge.targetHandle)
        assert.ok(out && into && out.kind === into.kind, `${template.id}: ${edge.source}.${edge.sourceHandle} → ${edge.target}.${edge.targetHandle}`)
      }
      // A mention names a node of the same document wired to it, or a project asset of any document of the template.
      const names = all.filter(node => node.name).map(node => node.name).sort((a, b) => b.length - a.length)
      for (const node of nodes) {
        let text = node.prompt ?? ''
        for (const name of names) {
          if (!text.includes('@' + name)) continue
          text = text.replaceAll('@' + name, '')
          const source = all.find(item => item.name === name)
          assert.ok(source.asset || edges.some(edge => edge.source === source.key && edge.target === node.key), `${template.id}: ${node.key} nennt @${name} ohne Verbindung`)
        }
      }
    }
  }
  const store = harness.ctx.creativeStore
  const project = store.createProject({ title: 'Kurzfilm' }).id
  const outfit = store.createAsset({ library: 'clips', title: 'Mantel', mediaType: 'image/png', media: png.toString('base64'), projectId: project }).id
  store.editTags({ ids: [outfit], add: ['Outfit'] })
  const api = `/creativity-flows/api/projects/${project}/documents`
  const made = await harness.json('POST', api, { templateId: 'konsistenter-film' }, 201)
  assert.deepEqual(made.docs.map(doc => [doc.kind, doc.title]), [['moodboard', 'Moodboard'], ['cast', 'Figur und Set'], ['storyboard', 'Film']], 'eine Vorlage legt neue Dokumente an')
  assert.deepEqual(made.skipped, [])
  const canvas = doc => store.appData(project, 'flow-' + doc.id).data
  const [mood, castDoc, filmDoc] = made.docs.map(canvas)
  const board = mood.nodes.find(node => node.type === 'moodboard')
  assert.deepEqual(board.params.items.filter(item => item.kind === 'file').map(item => item.assetId), [outfit], 'das Moodboard bekommt passende Bilder als freie Elemente')
  assert.deepEqual(board.params.items.filter(item => item.kind !== 'file').map(item => item.kind), ['note', 'word', 'word', 'word', 'word', 'word', 'color', 'color'])
  assert.equal(mood.nodes.length, 1, 'im Moodboard liegt nur die Pinnwand')
  assert.deepEqual(castDoc.nodes.filter(node => node.asset).map(node => node.name).sort(), ['Figur', 'Orte', 'Outfits', 'Set'])
  const regie = filmDoc.nodes.find(node => node.type === 'director')
  assert.deepEqual(filmDoc.nodes.filter(node => node.type === 'scene').map(node => node.params.from), [regie.id, regie.id, regie.id], 'die Beispielszenen gehören zur Regie')
  const of = type => filmDoc.nodes.filter(node => node.type === type).map(node => node.id)
  assert.equal(filmDoc.edges.filter(edge => of('image').includes(edge.source) && edge.targetHandle === 'start').length, 3, 'jedes Keyframe ist Startbild seines Videos')
  assert.equal(filmDoc.edges.filter(edge => of('composition').includes(edge.target)).length, 3)
  assert.ok(filmDoc.nodes.filter(node => node.type === 'image' || node.type === 'video').every(node => node.parentId), 'Keyframes und Videos liegen im Rahmen')
  const state = await harness.json('GET', `${api}/${made.docs[2].id}/state`)
  assert.deepEqual(state.projectAssets.map(item => [item.name, item.docTitle]).sort(), [['Figur', 'Figur und Set'], ['Look', 'Moodboard'], ['Orte', 'Figur und Set'], ['Outfits', 'Figur und Set'], ['Set', 'Figur und Set']], 'der Film sieht die Assets der anderen Dokumente')
  const again = await harness.json('POST', api, { templateId: 'moodboard' }, 201)
  assert.deepEqual(again.docs.map(doc => doc.title), ['Moodboard 2'], 'ein zweites Moodboard kommt neben das erste, nichts wird überschrieben')
  assert.equal(canvas(again.docs[0]).nodes[0].name, 'Look 2', 'Projekt-Assets bleiben eindeutig')
  assert.equal(canvas(made.docs[0]).nodes.length, 1, 'das erste Moodboard bleibt unverändert')
  const both = await harness.json('POST', api, { templateId: 'moodboard-und-storyboard' }, 201)
  assert.match(canvas(both.docs[1]).nodes.find(node => node.type === 'director').prompt, /@Look 3\./, 'die Regie nennt das Moodboard aus derselben Vorlage')
  const blank = await harness.json('POST', api, { kind: 'flow', title: 'Experimente' }, 201)
  assert.deepEqual([blank.docs[0].kind, canvas(blank.docs[0]).nodes], ['flow', []])
  await harness.json('POST', api, { kind: 'nope' }, 400)
  await harness.json('POST', api, { templateId: 'nope' }, 404)
  const listed = await harness.json('GET', '/creativity-flows/api/templates')
  assert.deepEqual(listed.filter(item => item.listed).map(item => item.id), ['moodboard', 'storyboard', 'moodboard-und-storyboard', 'konsistenter-film'])
  const docs = await harness.json('GET', api)
  assert.deepEqual(docs.docs.map(doc => doc.title), ['Moodboard', 'Figur und Set', 'Film', 'Moodboard 2', 'Moodboard 3', 'Storyboard', 'Experimente'])
  assert.deepEqual(docs.docs[0].cover, [outfit])
  assert.equal(docs.assets[outfit].title, 'Mantel')
  harness.unmountAll()
})

test('documents can be renamed, duplicated, split from frames and deleted; the former single canvas becomes the document Flow', async () => {
  const harness = createHarness()
  harness.mount(core, { databasePath: ':memory:' })
  harness.mount(flows)
  const store = harness.ctx.creativeStore
  const project = store.createProject({ title: 'Alt' }).id
  const api = `/creativity-flows/api/projects/${project}/documents`
  assert.deepEqual((await harness.json('GET', api)).docs, [], 'ein neues Projekt hat noch keine Dokumente')
  store.setAppData(project, 'flow', { revision: 0, data: { nodes: [
    { id: 'm', type: 'frame', name: '1 · Moodboard', x: 0, y: 0, params: { width: 800, height: 600, phase: 'moodboard' } },
    { id: 'n', type: 'text', name: 'Notiz', x: 40, y: 80, prompt: 'kühl', parentId: 'm' },
    { id: 's', type: 'frame', name: 'Storyboard', x: 1000, y: 0, params: { width: 800, height: 600 } },
    { id: 'z', type: 'scene', name: 'Auftritt', x: 40, y: 80, prompt: 'Tür', parentId: 's' },
    { id: 'frei', type: 'text', x: 3000, y: 0, prompt: 'frei' },
  ], edges: [edge('n', 'text', 'z', 'text')] } })
  const before = (await harness.json('GET', api)).docs
  assert.deepEqual(before.map(doc => [doc.id, doc.kind, doc.title]), [['flow', 'flow', 'Flow']])
  const split = await harness.json('POST', `${api}/flow/split`, {}, 201)
  assert.deepEqual(split.docs.map(doc => [doc.kind, doc.title]), [['moodboard', 'Moodboard'], ['storyboard', 'Storyboard']])
  assert.deepEqual(store.appData(project, 'flow-' + split.docs[1].id).data.nodes.map(node => [node.id, node.x, node.parentId]), [['z', 40, undefined]])
  assert.deepEqual(store.appData(project, 'flow').data.nodes.map(node => node.id), ['frei'], 'was in keinem Rahmen liegt, bleibt')
  await harness.json('POST', `${api}/flow/split`, {}, 400)
  const renamed = await harness.json('PATCH', `${api}/${split.docs[0].id}`, { title: 'Storyboard' })
  assert.equal(renamed.title, 'Storyboard 2', 'Namen bleiben eindeutig')
  const copy = await harness.json('POST', `${api}/${split.docs[1].id}/duplicate`, {}, 201)
  assert.equal(copy.title, 'Storyboard Kopie')
  assert.notEqual(store.appData(project, 'flow-' + copy.id).data.nodes[0].id, 'z', 'die Kopie hat eigene Knoten')
  assert.equal((await harness.request('DELETE', `${api}/${copy.id}`)).status, 204)
  assert.deepEqual((await harness.json('GET', api)).docs.map(doc => doc.title), ['Flow', 'Storyboard 2', 'Storyboard'])
  await harness.json('GET', `${api}/${copy.id}/state`, undefined, 404)
  assert.equal((await harness.request('DELETE', `${api}/${split.docs[0].id}`, undefined, 'cross-site')).status, 403)
  harness.unmountAll()
})

test('a project asset from another document reaches a prompt there, and it runs only in its own document', async () => {
  const { store, registry, project, save } = setup()
  const seen = []
  registry.register({ type: 'probe', title: 'Probe', group: 'image', icon: 'image', prompt: true,
    inputs: [{ id: 'refs', kind: 'image', label: 'Referenzen', multiple: true, mark: 'Bild' }], outputs: [{ id: 'image', kind: 'image', label: 'Bild' }],
    run: async ({ inputs, prompt }) => { seen.push({ refs: inputs.refs, prompt }); return { outputs: { image: [] } } } })
  registry.register({ type: 'looker', title: 'Look', group: 'text', icon: 'text', prompt: true,
    inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Look' }], run: async ({ prompt }) => ({ outputs: { text: [prompt] } }) })
  const a = store.createAsset({ library: 'clips', title: 'A', mediaType: 'image/png', media: png.toString('base64') }).id
  save({ nodes: [], edges: [] })
  const { createDoc } = await import('./apps/flows/engine/documents.mjs')
  const cast = createDoc(store, project, { kind: 'cast', canvas: { nodes: [{ id: 'figur', type: 'library', name: 'Figur', asset: true, x: 0, y: 0, params: { assetIds: [a] } }], edges: [] } })
  const mood = createDoc(store, project, { kind: 'moodboard', canvas: { nodes: [{ id: 'look', type: 'looker', name: 'Look', asset: true, x: 0, y: 0, prompt: 'Neon' }], edges: [] } })
  const film = createDoc(store, project, { kind: 'storyboard', canvas: { nodes: [{ id: 'p', type: 'probe', x: 0, y: 0, prompt: '@Figur im Stil @Look.' }], edges: [] } })
  const engine = createEngine(store, registry)
  assert.deepEqual(Object.keys(engine.view(project, film.id)), ['p'], 'die fremden Assets erscheinen nicht als Knoten')
  assert.deepEqual(engine.plan(project, 'p', 'upstream', film.id).map(step => step.id), ['p'], 'ein fremdes Asset läuft nicht von hier aus')
  engine.run(project, 'p', 'upstream', film.id)
  await until(() => engine.view(project, film.id).p.status === 'failed')
  assert.match(engine.view(project, film.id).p.error, /Führe zuerst „Look“ in „Moodboard“ aus/)
  engine.run(project, 'look', 'node', mood.id)
  await until(() => engine.view(project, mood.id).look.status === 'done')
  engine.run(project, 'p', 'node', film.id)
  await until(() => engine.view(project, film.id).p.status === 'done')
  assert.deepEqual(seen[0], { refs: [a], prompt: '@Bild1 im Stil Neon.' })
  assert.throws(() => engine.plan(project, 'look', 'node', film.id), /gibt es im gespeicherten Flow nicht/)
  assert.deepEqual(engine.foreignAssets(project, film.id).map(item => [item.name, item.docTitle, item.ready]), [['Figur', cast.title, true], ['Look', mood.title, true]])
  store.close()
})

test('frames become sub-flows: nodes inside get the frame as parent and relative positions, nodes outside lose it', () => {
  const isFrame = node => node.type === 'frame'
  const legacy = { nodes: [
    { id: 'n', type: 'text', x: 150, y: 120 },
    { id: 'f', type: 'frame', x: 100, y: 100, params: { width: 400, height: 300 } },
    { id: 'o', type: 'text', x: 900, y: 120 },
  ], edges: [] }
  const { doc, changed } = adoptIntoFrames(legacy, isFrame)
  assert.equal(changed, true)
  assert.deepEqual(doc.nodes.map(node => [node.id, node.parentId ?? null, node.x, node.y]), [['f', null, 100, 100], ['n', 'f', 50, 20], ['o', null, 900, 120]])
  assert.equal(adoptIntoFrames(doc, isFrame).changed, false)
  const dragged = { ...doc, nodes: doc.nodes.map(node => node.id === 'n' ? { ...node, x: 700 } : node) }
  const out = adoptIntoFrames(dragged, isFrame).doc.nodes.find(node => node.id === 'n')
  assert.deepEqual([out.parentId, out.x, out.y], [undefined, 800, 120])
  assert.deepEqual(absolute(doc.nodes[1], new Map(doc.nodes.map(node => [node.id, node]))), { x: 150, y: 120 })
})

test('the Flows editor never uses class names that the hub stylesheet also defines', async () => {
  const { readdirSync } = await import('node:fs')
  const hub = new Set([...readFileSync('web/app.css', 'utf8').matchAll(/^\.([a-zA-Z][\w-]*)/gm)].map(match => match[1]))
  // The editor uses these hub classes on purpose (shared inputs and buttons); every other overlap would be a clash.
  const shared = new Set(['btn', 'text-in', 'canvas-note', 'sm', 'err', 'chip'])
  const files = ['apps/flows/editor.jsx', ...readdirSync('apps/flows/ui/components').filter(name => name.endsWith('.jsx')).map(name => 'apps/flows/ui/components/' + name),
    ...readdirSync('apps/flows/ui/components/ui').map(name => 'apps/flows/ui/components/ui/' + name)]
  for (const file of files) {
    const tokens = new Set([...readFileSync(file, 'utf8').matchAll(/(?<=["'`\s])([a-z][\w-]*)(?=[\s"'`])/g)].map(match => match[1]))
    const clash = [...tokens].filter(token => hub.has(token) && !shared.has(token) && /className|cn\(/.test(readFileSync(file, 'utf8')))
      .filter(token => new RegExp(`(className=|cn\\()[^\\n]*["'\`\\s]${token}["'\`\\s]`).test(readFileSync(file, 'utf8')))
    assert.deepEqual(clash, [], `${file} nutzt Hub-Klassen: ${clash.join(', ')}`)
  }
})

test('project assets reach every prompt that mentions them, without a line: files as marks, text in place', async () => {
  const { store, registry, project, save } = setup()
  const seen = []
  registry.register({ type: 'probe', title: 'Probe', group: 'image', icon: 'image', prompt: true,
    inputs: [{ id: 'prompt', kind: 'text', label: 'Prompt', multiple: true }, { id: 'start', kind: 'image', label: 'Start', mark: 'Bild' }, { id: 'refs', kind: 'image', label: 'Referenzen', multiple: true, mark: 'Bild' }],
    outputs: [{ id: 'image', kind: 'image', label: 'Bild' }],
    run: async ({ inputs, prompt }) => { seen.push({ prompt, text: inputs.prompt, refs: inputs.refs, keys: Object.keys(inputs) }); return { outputs: { image: inputs.refs } } } })
  registry.register({ type: 'looker', title: 'Look', group: 'text', icon: 'text', prompt: true,
    inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Look' }], run: async ({ prompt }) => ({ outputs: { text: [prompt] } }) })
  const a = store.createAsset({ library: 'clips', title: 'A', mediaType: 'image/png', media: png.toString('base64') }).id
  save({ nodes: [
    { id: 'figur', type: 'library', name: 'Figur', asset: true, x: 0, y: 0, params: { assetIds: [a] } },
    { id: 'look', type: 'looker', name: 'Look', asset: true, x: 0, y: 300, prompt: 'Analoger Film' },
    { id: 'szene', type: 'scene', x: 400, y: 0, prompt: '@Figur geht durch den Flur.' },
    { id: 'p', type: 'probe', x: 800, y: 0, prompt: 'Im Stil @Look.' },
    { id: 'fremd', type: 'probe', x: 800, y: 600, prompt: 'Ohne Bezug.' },
  ], edges: [edge('szene', 'text', 'p', 'prompt')] })
  const typeOf = name => { const type = registry.node(name); return type && { ...type, runs: Boolean(type.run) } }
  assert.deepEqual(implicitEdges(store.appData(project, 'flow').data, typeOf).map(item => [item.source, item.sourceHandle, item.target, item.targetHandle]),
    [['figur', 'image', 'p', 'refs'], ['look', 'text', 'p', '@text']], 'die Szene trägt @Figur, der eigene Prompt @Look; Startbild bleibt frei')
  const engine = createEngine(store, registry)
  assert.deepEqual(engine.plan(project, 'p', 'upstream').map(step => step.id), ['look', 'p'], 'das Asset ohne Ergebnis läuft vorher')
  engine.run(project, 'p', 'upstream')
  await until(() => engine.view(project).p.status === 'done')
  assert.deepEqual(seen[0].refs, [a])
  assert.deepEqual(seen[0].text, ['@Bild1 geht durch den Flur.'])
  assert.equal(seen[0].prompt, 'Im Stil Analoger Film.')
  assert.ok(!seen[0].keys.includes('_texts'), 'der Look-Text geht nicht als Eingang an den Knoten')
  assert.equal(engine.view(project).p.stale, false)
  save({ ...store.appData(project, 'flow').data, nodes: store.appData(project, 'flow').data.nodes.map(node => node.id === 'look' ? { ...node, prompt: 'Neon' } : node) })
  engine.run(project, 'look')
  await until(() => engine.view(project).look.status === 'done' && engine.view(project).look.outputs.text[0] === 'Neon')
  assert.equal(engine.view(project).p.stale, true, 'ein neuer Look macht das Ergebnis veraltet')
  assert.equal(engine.view(project).fremd.stale, false)
  store.close()
})

test('Style-DNA condenses a moodboard into a look text and key images; Regie returns shots and assets as data', async () => {
  const store = openStore(':memory:')
  const images = ['A', 'B', 'C', 'D'].map(title => store.createAsset({ library: 'clips', title, mediaType: 'image/png', media: png.toString('base64') }).id)
  const answers = []
  const calls = []
  const providers = {
    list: async () => [{ id: 'litellm', title: 'LiteLLM', capabilities: ['chat'], chatImages: true, chatFiles: false, secrets: [{ configured: true }] }],
    call: async (id, action, input) => { calls.push(input); return { text: answers.shift() } },
  }
  assert.deepEqual(parseJson('Hier: ```json\n{"a": 1}\n``` fertig'), { a: 1 })
  assert.equal(parseJson('kein JSON'), null)
  const dna = styleNode(providers, store)
  answers.push('{"look": "Kaltes Klinikweiß.", "light": "hart", "camera": "35 mm, Korn", "palette": "#B3122E", "materials": "Latex", "keyImages": [4, 2, 9]}')
  const look = await dna.run({ inputs: { text: ['Farbe #B3122E'], images }, params: {}, prompt: '' })
  assert.deepEqual(look.outputs.image, [images[3], images[1]], 'nur gültige Nummern, in der Reihenfolge des Modells')
  assert.equal(look.outputs.text[0], 'Kaltes Klinikweiß.\nLicht: hart\nKamera: 35 mm, Korn\nPalette: #B3122E\nMaterial: Latex')
  assert.match(calls[0].prompt, /Farbe #B3122E/)
  answers.push('Leider nein.')
  await assert.rejects(dna.run({ inputs: { text: [], images }, params: {}, prompt: '' }), /keinen lesbaren Look/)
  const director = directorNode(providers, store)
  answers.push(JSON.stringify({ shots: [{ title: 'Erwachen', duration: 30, shot: 'Totale', prompt: '@Figur wacht auf.', motion: 'Kamera steht.' }, { title: '', duration: 'x', prompt: '@Figur geht.' }, { title: 'leer' }],
    assets: [{ name: '@Figur', kind: 'figur', description: 'Frau' }, { name: 'Tür', kind: 'tür' }] }))
  const plan = await director.run({ inputs: { prompt: ['Story'], images: [] }, params: {}, prompt: 'Drei Einstellungen.', assets: ['Figur', 'Look'] })
  assert.match(calls.at(-1).prompt, /Projekt-Assets: @Figur, @Look/)
  assert.deepEqual(plan.data.shots.map(shot => [shot.title, shot.duration]), [['Erwachen', 15], ['Einstellung 2', 5]])
  assert.deepEqual(plan.data.assets, [{ name: 'Figur', kind: 'figur', description: 'Frau' }, { name: 'Tür', kind: 'requisite', description: '' }])
  assert.equal(plan.outputs.text[0], '1. Erwachen (15 s, Totale): @Figur wacht auf. Bewegung: Kamera steht.\n2. Einstellung 2 (5 s): @Figur geht.')
  answers.push('{"shots": []}')
  await assert.rejects(director.run({ inputs: { prompt: ['Story'], images: [] }, params: {}, prompt: '' }), /keine lesbare Shotliste/)
  store.close()
})

test('the moodboard pins items without lines, gives its pictures at once and its structured look after a click', async () => {
  const { store, registry, project, save } = setup()
  const answers = []
  const calls = []
  const providers = {
    list: async () => [{ id: 'litellm', title: 'LiteLLM', capabilities: ['chat'], chatImages: true, chatFiles: false, secrets: [{ configured: true }] }],
    call: async (id, action, input) => { calls.push(input); return { text: answers.shift() } },
  }
  registry.register(moodboardNode(providers, store))
  const seen = []
  registry.register({ type: 'probe', title: 'Probe', group: 'image', icon: 'image', prompt: true, paid: true,
    inputs: [{ id: 'refs', kind: 'image', label: 'Referenzen', multiple: true, mark: 'Bild' }], outputs: [{ id: 'image', kind: 'image', label: 'Bild' }],
    run: async ({ inputs, prompt }) => { seen.push({ refs: inputs.refs, prompt }); return { outputs: { image: [] } } } })
  const pictures = ['A', 'B', 'C'].map(title => store.createAsset({ library: 'clips', title, mediaType: 'image/png', media: png.toString('base64') }).id)
  const clip = store.createAsset({ library: 'clips', title: 'Clip', mediaType: 'video/mp4', media: Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex').toString('base64') }).id
  save({ nodes: [
    { id: 'look', type: 'moodboard', name: 'Look', asset: true, x: 0, y: 0, params: { items: [
      { id: '1', kind: 'file', assetId: pictures[1], x: 200, y: 0 }, { id: '2', kind: 'file', assetId: pictures[0], x: 0, y: 0 },
      { id: '3', kind: 'file', assetId: clip, x: 0, y: 300 }, { id: '4', kind: 'file', assetId: 'weg', x: 0, y: 400 },
      { id: '5', kind: 'word', text: 'Latex', x: 400, y: 0 }, { id: '6', kind: 'word', text: 'Neon', x: 500, y: 0 },
      { id: '7', kind: 'color', color: '#b3122e', x: 400, y: 100 }, { id: '8', kind: 'note', text: 'Korn', x: 400, y: 200 },
      { id: '9', kind: 'bogus' }, { id: '10', kind: 'file', assetId: pictures[2], x: 400, y: 50 },
    ] } },
    { id: 'p', type: 'probe', x: 900, y: 0, prompt: 'Im Stil @Look.' },
  ], edges: [] })
  const engine = createEngine(store, registry)
  const before = engine.view(project).look.outputs
  assert.deepEqual(before.images, [pictures[0], pictures[1], pictures[2]], 'Bilder in Leserichtung, ohne Lauf')
  assert.deepEqual(before.videos, [clip])
  assert.deepEqual(before.notes, ['Korn', 'Stichworte: Latex, Neon', 'Farbe #B3122E'])
  assert.deepEqual(engine.plan(project, 'p', 'node').map(step => step.id), ['p'])
  engine.run(project, 'p')
  await until(() => engine.view(project).p.status === 'failed')
  assert.match(engine.view(project).p.error, /Führe zuerst „Look“ aus/, '@Look braucht den erzeugten Look')
  answers.push('{"look": "Kalt und glänzend.", "light": "hart", "camera": "", "palette": "Rot #B3122E", "materials": "Latex", "keyImages": [3]}')
  engine.run(project, 'p', 'upstream')
  await until(() => engine.view(project).p.status === 'done')
  assert.match(calls[0].prompt, /Stichworte: Latex, Neon/)
  assert.equal(calls[0].images.length, 3, 'nur Bilder gehen an das Modell')
  const look = engine.view(project).look
  assert.deepEqual(look.data, { look: 'Kalt und glänzend.', light: 'hart', camera: '', palette: 'Rot #B3122E', materials: 'Latex' })
  assert.deepEqual(look.outputs.keys, [pictures[2]])
  assert.deepEqual(look.outputs.images, [pictures[0], pictures[1], pictures[2]], 'die Bilder bleiben neben dem Ergebnis')
  assert.deepEqual(seen[0].refs, [pictures[2]], '@Look bringt nur die Leitbilder, nicht das ganze Board')
  assert.equal(seen[0].prompt, 'Im Stil Kalt und glänzend.\nLicht: hart\nPalette: Rot #B3122E\nMaterial: Latex (@Bild1).')
  save({ ...store.appData(project, 'flow').data, nodes: store.appData(project, 'flow').data.nodes.map(node => node.id === 'look' ? { ...node, params: { items: [] } } : node) })
  assert.equal(engine.view(project).look.stale, true, 'ein geändertes Board macht den Look veraltet')
  const empty = moodboardNode(providers, store)
  await assert.rejects(empty.run({ params: { items: [] } }), /Leg zuerst Bilder/)
  store.close()
})
