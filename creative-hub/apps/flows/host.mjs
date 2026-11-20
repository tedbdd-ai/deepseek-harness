/**
 * Plugin "Flows": a canvas per project on which generation steps are nodes joined by lines.
 *
 * The canvas replaces the former Moodboard and Storyboard. Node types come from `creativeNodes`: this plugin registers
 * the free board nodes (Notiz, Datei, Szene, Farbe, Link, Rahmen); the image, video and composition nodes come from the
 * Foto Playground, the Video Playground and the Schnitt plugin. The flow itself is `app_data(flow)` of the project,
 * written by the editor through the hub API.
 *
 * Routes (same-origin JSON, Harness session required), under `/creativity-flows/api`:
 * - `GET  /nodes` → node types with ports and settings fields
 * - `GET  /projects/<id>/state` → `{ nodes: { [nodeId]: { status, outputs, stale, refs, warnings, error, credits, ms, history } }, assets: { [id]: asset } }`
 * - `POST /projects/<id>/run { nodeId, scope: 'node'|'upstream'|'downstream', dryRun? }` → `{ steps }`; without `dryRun`
 *   the steps start at once. Paid nodes run only through this route, which the editor calls on a click.
 * - `GET  /templates` → `{ id, title, description, phases }[]`, ready canvases from `engine/templates.mjs`
 * - `POST /projects/<id>/templates { templateId, revision }` → `{ record, added, skipped }`: places the template right of the
 *   existing nodes and fills its Datei nodes from the Library; nothing runs
 * - `GET  /projects/<id>/import-boards` → `{ nodes }`, the number of nodes the former Moodboard and Storyboard would give
 * - `POST /projects/<id>/import-boards` → the new flow record; only into an empty flow, the old boards stay as they are
 * - `POST /projects/<id>/nodes/<nodeId>/pick { index }` → the state, after an earlier result became current again
 */
import { randomUUID } from 'node:crypto'
import { readBody, responder } from '../../http.mjs'
import { InputError, idPattern } from '../../store.mjs'
import { defineApp } from '../define-app.mjs'
import { createEngine } from './engine/engine.mjs'
import { adoptIntoFrames } from './engine/frames.mjs'
import { insertTemplate, templates } from './engine/templates.mjs'

const app = defineApp({
  id: 'flows', title: 'Flows', page: true,
  description: 'Bild-, Video- und Schnittschritte als Knoten verbinden und ausführen',
  icon: 'M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 5h5a3 3 0 0 1 3 3v8a3 3 0 0 0 3 3',
}, import.meta.url)

export const name = app.name
export const inject = [...app.inject, 'creativeStore', 'creativeNodes']

const base = '/creativity-flows/api'
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Kind of the port an asset goes out on; links with a preview count as images. */
export function assetKind(asset) {
  const type = asset.media_type ?? ''
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('image/') || (!type && asset.preview)) return 'image'
  return null
}

/** The free nodes of the canvas: board items in the style of Milanote and Miro, Library files and frames. */
export function sourceNodes(store) {
  const existing = id => { try { return store.asset(id) } catch (error) { if (error instanceof InputError) return null; throw error } }
  const assetOutputs = ids => {
    const outputs = { image: [], video: [], audio: [] }
    for (const id of ids) {
      const asset = existing(id)
      const kind = asset && assetKind(asset)
      if (kind) outputs[kind].push(id)
    }
    return outputs
  }
  const ids = value => Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 24) : []
  const text = value => typeof value === 'string' && value.trim() ? [value.trim()] : []
  return [
    { type: 'text', title: 'Notiz', group: 'board', icon: 'text', prompt: true, description: 'Idee, Story oder Prompt. Geht als Text an verbundene Knoten.',
      inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Text' }],
      resolve: ({ prompt }) => ({ text: text(prompt) }) },
    { type: 'library', title: 'Datei', group: 'board', icon: 'library', description: 'Bilder, Videos oder Ton aus Sammlung und Library. Auch per Einfügen oder Hineinziehen.',
      inputs: [], outputs: [{ id: 'image', kind: 'image', label: 'Bilder' }, { id: 'video', kind: 'video', label: 'Videos' }, { id: 'audio', kind: 'audio', label: 'Ton' }],
      fields: async () => [{ key: 'assetIds', label: 'Dateien', type: 'assets' }],
      resolve: ({ params }) => assetOutputs(ids(params.assetIds)) },
    { type: 'scene', title: 'Szene', group: 'board', icon: 'shot', prompt: true, description: 'Eine Einstellung des Storyboards: was passiert, wie lange, mit welchem Startbild.',
      inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Szenenprompt' }, { id: 'image', kind: 'image', label: 'Startbild' }],
      fields: async () => [{ key: 'assetIds', label: 'Startbild', type: 'assets', single: true }, { key: 'duration', label: 'Dauer (s)', type: 'enum', options: ['4', '5', '6', '8', '10', '12', '15'], default: '5' }],
      resolve: ({ params, prompt }) => ({ text: text(prompt), image: assetOutputs(ids(params.assetIds).slice(0, 1)).image }) },
    { type: 'color', title: 'Farbe', group: 'board', icon: 'color', description: 'Ein Farbton für den Look. Geht als Text („Farbe #…“) weiter.',
      inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Farbe' }],
      fields: async () => [{ key: 'color', label: 'Farbton', type: 'color', default: '#8A6A4F' }],
      resolve: ({ params }) => ({ text: /^#[0-9a-f]{6}$/i.test(params.color ?? '') ? ['Farbe ' + params.color.toUpperCase()] : [] }) },
    { type: 'link', title: 'Link', group: 'board', icon: 'link', description: 'Eine Webadresse als Notiz. Geht als Text weiter.',
      inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Adresse' }],
      fields: async () => [{ key: 'url', label: 'Adresse', type: 'url' }],
      resolve: ({ params }) => ({ text: /^https?:\/\/\S+$/i.test(params.url ?? '') ? [params.url] : [] }) },
    { type: 'frame', title: 'Rahmen', group: 'board', icon: 'board', contains: true,
      description: 'Fasst Knoten zu einem Bereich zusammen, etwa Moodboard oder Szene 1. Gibt alles darin weiter.',
      inputs: [], outputs: [{ id: 'image', kind: 'image', label: 'Bilder darin' }, { id: 'video', kind: 'video', label: 'Videos darin' },
        { id: 'audio', kind: 'audio', label: 'Ton darin' }, { id: 'text', kind: 'text', label: 'Text darin' }],
      resolve: ({ members }) => members },
  ]
}

/**
 * Builds a flow from the project's former Moodboard and Storyboard (`app_data(moodboard|storyboard)`), which stay untouched.
 * The Moodboard becomes a frame with its files and cards, the Storyboard a frame with the story as a note and one scene per shot.
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function boardsToFlow(store, projectId) {
  const mood = store.appData(projectId, 'moodboard').data
  const story = store.appData(projectId, 'storyboard').data
  const nodes = []
  const id = () => randomUUID()
  const cardNode = (card, x, y) => card.type === 'color'
    ? { id: id(), type: 'color', name: card.title || '', x, y, prompt: '', params: { color: card.color } }
    : card.type === 'link'
      ? { id: id(), type: 'link', name: card.title || '', x, y, prompt: '', params: { url: card.text } }
      : { id: id(), type: 'text', name: card.title || '', x, y, prompt: card.text ?? '', params: {} }
  const items = Array.isArray(mood.items) ? mood.items : []
  const moodCards = Array.isArray(mood.cards) ? mood.cards : []
  let bottom = 0
  if (items.length || moodCards.length) {
    const placed = [...items.map(item => ({ item })), ...moodCards.map(card => ({ card }))].map((entry, i) => {
      const key = entry.item?.id ?? entry.card.id
      const at = mood.positions?.[key] ?? { x: (i % 5) * 288, y: Math.floor(i / 5) * 320 }
      return { ...entry, x: Number(at.x) || 0, y: Number(at.y) || 0 }
    })
    const minX = Math.min(...placed.map(p => p.x)), minY = Math.min(...placed.map(p => p.y))
    for (const p of placed) {
      const x = Math.round(p.x - minX + 48), y = Math.round(p.y - minY + 96)
      nodes.push(p.item ? { id: id(), type: 'library', x, y, prompt: '', params: { assetIds: [p.item.id] } } : cardNode(p.card, x, y))
    }
    const width = Math.max(...nodes.map(node => node.x)) + 352, height = Math.max(...nodes.map(node => node.y)) + 400
    nodes.unshift({ id: id(), type: 'frame', name: 'Moodboard', x: 0, y: 0, prompt: '', params: { width, height } })
    bottom = height + 96
  }
  const shots = Array.isArray(story.shots) ? story.shots : []
  if (shots.length || story.story?.trim()) {
    const top = bottom
    const inner = []
    if (story.story?.trim()) inner.push({ id: id(), type: 'text', name: 'Story', x: 48, y: top + 96, prompt: story.story.trim(), params: {} })
    shots.forEach((shot, i) => inner.push({ id: id(), type: 'scene', name: shot.title || `Einstellung ${i + 1}`, x: 48 + i * 304, y: top + (story.story?.trim() ? 448 : 96),
      prompt: shot.prompt ?? '', params: { duration: String(shot.duration ?? 5), assetIds: shot.ref ? [shot.ref] : [] } }))
    const width = Math.max(...inner.map(node => node.x)) + 352, height = Math.max(...inner.map(node => node.y)) - top + 440
    nodes.push({ id: id(), type: 'frame', name: 'Storyboard', x: 0, y: top, prompt: '', params: { width, height } }, ...inner)
  }
  return adoptIntoFrames({ nodes, edges: [] }, node => node.type === 'frame').doc
}

/** Node types as JSON for the editor: functions become their results (`fields`) or flags (`run`). */
async function describe(registry) {
  return Promise.all(registry.nodes().map(async node => ({
    type: node.type, title: node.title, group: node.group, icon: node.icon, description: node.description ?? '',
    inputs: node.inputs, outputs: node.outputs, paid: Boolean(node.paid), prompt: Boolean(node.prompt), runs: Boolean(node.run), contains: Boolean(node.contains),
    fields: node.fields ? await node.fields() : [],
  })))
}

/**
 * Adds the Library entries behind every media value of the view, so the editor can show previews without
 * a request per asset. Entries deleted from the Library are left out.
 * @returns {{ nodes: object, assets: Record<string, object> }}
 */
function withAssets(store, nodes) {
  const ids = new Set()
  for (const view of Object.values(nodes)) {
    for (const outputs of [view.outputs, ...(view.history ?? []).map(entry => entry.outputs)]) {
      for (const [port, values] of Object.entries(outputs ?? {})) {
        if (port !== 'text') for (const id of values) ids.add(id)
      }
    }
  }
  const assets = {}
  for (const id of ids) {
    try { assets[id] = store.asset(id) } catch (error) { if (!(error instanceof InputError)) throw error }
  }
  return { nodes, assets }
}

/** HTTP handler for the routes listed in the module comment. */
export function createHandler(store, registry, engine) {
  return async (req, res) => {
    const { json } = responder(req, res)
    try {
      const path = new URL(req.url, 'http://localhost').pathname.slice(base.length)
      if (req.method === 'POST' && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new InputError('Schreibzugriff aus dieser Quelle ist gesperrt.', 403)
      if (req.method === 'GET' && path === '/nodes') return json(await describe(registry))
      const state = new RegExp(`^/projects/(${uuid})/state$`).exec(path)
      if (req.method === 'GET' && state) return json(withAssets(store, engine.view(state[1])))
      const run = new RegExp(`^/projects/(${uuid})/run$`).exec(path)
      if (req.method === 'POST' && run) {
        const body = await readBody(req)
        if (typeof body.nodeId !== 'string' || !idPattern.test(body.nodeId)) throw new InputError('Wähle einen Knoten.')
        if (body.dryRun) return json({ steps: engine.plan(run[1], body.nodeId, body.scope ?? 'node') })
        return json({ steps: engine.run(run[1], body.nodeId, body.scope ?? 'node') }, 202)
      }
      if (req.method === 'GET' && path === '/templates') return json(templates.map(({ id, title, description, phases }) => ({ id, title, description, phases })))
      const template = new RegExp(`^/projects/(${uuid})/templates$`).exec(path)
      if (req.method === 'POST' && template) {
        const { templateId, revision } = await readBody(req)
        if (typeof templateId !== 'string' || !Number.isInteger(revision)) throw new InputError('Wähle eine Vorlage.')
        return json(insertTemplate(store, template[1], templateId, revision, type => Boolean(registry.node(type))), 201)
      }
      const boards = new RegExp(`^/projects/(${uuid})/import-boards$`).exec(path)
      if (req.method === 'GET' && boards) {
        const flow = boardsToFlow(store, boards[1])
        return json({ nodes: flow.nodes.length })
      }
      if (req.method === 'POST' && boards) {
        await readBody(req)
        const current = store.appData(boards[1], 'flow')
        if (current.data.nodes?.length) throw new InputError('Der Flow ist nicht mehr leer. Übernimm Moodboard und Storyboard nur in einen leeren Flow.', 409)
        return json(store.setAppData(boards[1], 'flow', { revision: current.revision, data: boardsToFlow(store, boards[1]) }), 201)
      }
      const pick = new RegExp(`^/projects/(${uuid})/nodes/([a-z0-9-]+)/pick$`).exec(path)
      if (req.method === 'POST' && pick) {
        const { index } = await readBody(req)
        if (!Number.isInteger(index)) throw new InputError('Wähle ein Ergebnis aus dem Verlauf.')
        engine.pick(pick[1], pick[2], index)
        return json(withAssets(store, engine.view(pick[1])))
      }
      throw new InputError('Seite nicht gefunden.', 404)
    } catch (error) {
      if (error instanceof InputError) return json({ error: error.message }, error.status)
      console.error('Flows:', error)
      return json({ error: 'Flows konnte die Anfrage nicht abschließen.' }, 500)
    }
  }
}

export function apply(ctx) {
  app.apply(ctx)
  const store = ctx.creativeStore
  const registry = ctx.creativeNodes
  for (const node of sourceNodes(store)) ctx.effect(() => registry.register(node))
  const engine = createEngine(store, registry)
  ctx.effect(() => () => engine.stop())
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/creativity-flows', auth: 'required', handler: createHandler(store, registry, engine) }))
}
