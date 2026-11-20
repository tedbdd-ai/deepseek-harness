/**
 * Plugin "Flows": a canvas per project on which generation steps are nodes joined by lines.
 *
 * Node types come from `creativeNodes`; this plugin registers the free source nodes (Text, Library, Moodboard,
 * Einstellung) and the image, video and composition nodes come from the Foto Playground, the Video Playground and
 * the Schnitt plugin. The flow itself is `app_data(flow)` of the project, written by the editor through the hub API.
 *
 * Routes (same-origin JSON, Harness session required), under `/creativity-flows/api`:
 * - `GET  /nodes` → node types with ports and settings fields
 * - `GET  /projects/<id>/state` → `{ nodes: { [nodeId]: { status, outputs, stale, error, credits, ms, history } }, assets: { [id]: asset } }`
 * - `POST /projects/<id>/run { nodeId, scope: 'node'|'upstream'|'downstream', dryRun? }` → `{ steps }`; without `dryRun`
 *   the steps start at once. Paid nodes run only through this route, which the editor calls on a click.
 * - `POST /projects/<id>/nodes/<nodeId>/pick { index }` → the state, after an earlier result became current again
 */
import { readBody, responder } from '../../http.mjs'
import { InputError, idPattern } from '../../store.mjs'
import { defineApp } from '../define-app.mjs'
import { createEngine } from './lib/engine.mjs'

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

/** The free source nodes of the canvas. */
export function sourceNodes(store) {
  const assetOutputs = ids => {
    const outputs = { image: [], video: [], audio: [] }
    for (const id of ids) {
      const kind = assetKind(store.asset(id))
      if (kind) outputs[kind].push(id)
    }
    return outputs
  }
  return [
    { type: 'text', title: 'Text', group: 'text', icon: 'text', prompt: true, description: 'Ein Prompt oder eine Anweisung für mehrere Knoten.',
      inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Text' }],
      resolve: ({ prompt }) => ({ text: prompt.trim() ? [prompt.trim()] : [] }) },
    { type: 'library', title: 'Aus der Library', group: 'source', icon: 'library', description: 'Bilder, Videos oder Ton aus Sammlung und Library.',
      inputs: [], outputs: [{ id: 'image', kind: 'image', label: 'Bilder' }, { id: 'video', kind: 'video', label: 'Videos' }, { id: 'audio', kind: 'audio', label: 'Ton' }],
      fields: async () => [{ key: 'assetIds', label: 'Dateien', type: 'assets' }],
      resolve: ({ params }) => assetOutputs(Array.isArray(params.assetIds) ? params.assetIds.filter(id => typeof id === 'string').slice(0, 24) : []) },
    { type: 'moodboard', title: 'Moodboard', group: 'source', icon: 'board', description: 'Alle Bilder auf dem Moodboard des Projekts.',
      inputs: [], outputs: [{ id: 'image', kind: 'image', label: 'Bilder' }],
      resolve: ({ projectId }) => {
        const items = store.appData(projectId, 'moodboard').data.items
        const ids = Array.isArray(items) ? items.map(item => item.id).filter(id => typeof id === 'string') : []
        return { image: ids.filter(id => { try { return assetKind(store.asset(id)) === 'image' } catch (error) { if (error instanceof InputError) return false; throw error } }) }
      } },
    { type: 'shot', title: 'Einstellung', group: 'source', icon: 'shot', description: 'Szenenprompt und Startbild einer Storyboard-Einstellung.',
      inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Szenenprompt' }, { id: 'image', kind: 'image', label: 'Startbild' }],
      fields: async () => [{ key: 'shotId', label: 'Einstellung', type: 'shot' }],
      resolve: ({ params, projectId }) => {
        const shot = store.appData(projectId, 'storyboard').data.shots?.find(item => item.id === params.shotId)
        if (!shot) return { text: [], image: [] }
        return { text: shot.prompt?.trim() ? [shot.prompt.trim()] : [], image: shot.ref ? [shot.ref] : [] }
      } },
  ]
}

/** Node types as JSON for the editor: functions become their results (`fields`) or flags (`run`). */
async function describe(registry) {
  return Promise.all(registry.nodes().map(async node => ({
    type: node.type, title: node.title, group: node.group, icon: node.icon, description: node.description ?? '',
    inputs: node.inputs, outputs: node.outputs, paid: Boolean(node.paid), prompt: Boolean(node.prompt), runs: Boolean(node.run),
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
