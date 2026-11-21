/**
 * Plugin "Flows": canvases on which generation steps are nodes joined by lines, organised as documents of a project.
 *
 * A project holds documents: Moodboards, Storyboards, Filme and free Flows, each its own canvas
 * (`engine/documents.mjs`). The way of a film: the moodboard makes look, idea and sketches; the storyboard makes scenes,
 * figure and set (character studio) and a picture per scene; „An Film übergeben“ moves the scenes into a film, where
 * they become videos and the cut. The pages „Flows“ (all documents of a project) and „Moodboards“, „Storyboards“,
 * „Filme“ (one kind) list them; opening one shows only that document. Node types come from `creativeNodes`:
 * this plugin registers the board nodes (Notiz, Datei, Szene, Farbe, Link, Rahmen); image, video, composition and the
 * language-model nodes come from other plugins.
 *
 * Routes (same-origin JSON, Harness session required), under `/creativity-flows/api`:
 * - `GET  /nodes` → node types with ports and settings fields
 * - `GET  /templates` → `{ id, title, description, steps, kind, listed }[]` from `engine/templates.mjs`
 * - `GET  /projects/<id>/documents` → `{ docs: [{ id, kind, title, createdAt, updatedAt, nodes, cover }], assets }`, the cover
 *   pictures' Library entries in `assets`
 * - `POST /projects/<id>/documents { templateId } | { kind, title? }` → `{ docs, skipped }`: new documents, the first one
 *   is the one to open; nothing runs
 * - `PATCH /projects/<id>/documents/<doc> { title }`, `DELETE /projects/<id>/documents/<doc>`,
 *   `POST /projects/<id>/documents/<doc>/duplicate`, `POST /projects/<id>/documents/<doc>/split` (frames become documents)
 * - `POST /projects/<id>/documents/<storyboard>/handoff { sceneIds }` → `{ doc, added, updated }`: the scenes go with
 *   their storyboard pictures into the storyboard's film document (`engine/handoff.mjs`); nothing runs
 * - `GET  /projects/<id>/documents/<doc>/state` → `{ nodes: { [nodeId]: { status, outputs, stale, refs, … } }, assets, projectAssets }`
 * - `POST /projects/<id>/documents/<doc>/run { nodeId, scope: 'node'|'upstream'|'downstream', dryRun? }` → `{ steps }`;
 *   without `dryRun` the steps start at once. `nodeId` may be a list of up to 64 ids (film strip). Paid nodes run only
 *   through this route, which the editor calls on a click.
 * - `POST /projects/<id>/documents/<doc>/nodes/<nodeId>/pick { index }` → the state, after an earlier result became current
 * - `GET  /projects/<id>/import-boards` → `{ nodes }`; `POST` makes a new document from the former Moodboard and Storyboard
 * The state, run and pick routes also answer without `/documents/<doc>` for the document `flow`, the former single canvas.
 * The canvas of a document is read and written through the hub API (`/projects/<id>/apps/flow-<doc>`).
 */
import { randomUUID } from 'node:crypto'
import { readBody, responder } from '../../http.mjs'
import { InputError, idPattern } from '../../store.mjs'
import { defineApp } from '../define-app.mjs'
import { createEngine } from './engine/engine.mjs'
import { adoptIntoFrames, readingOrder } from './engine/frames.mjs'
import { checkDocId, createDoc, deleteDoc, docKey, duplicateDoc, getDoc, kinds, listDocs, renameDoc, splitDoc } from './engine/documents.mjs'
import { createFromTemplate, templates } from './engine/templates.mjs'
import { handOff } from './engine/handoff.mjs'

const app = defineApp({
  id: 'flows', title: 'Flows', page: true, project: '/creativity-apps/flows/project.js',
  description: 'Bild-, Video- und Schnittschritte als Knoten verbinden und ausführen',
  icon: 'M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 5h5a3 3 0 0 1 3 3v8a3 3 0 0 0 3 3',
}, import.meta.url)

export const name = app.name
export const inject = [...app.inject, 'creativeStore', 'creativeNodes']

/**
 * Document lists per kind as sidebar entries of their own: the Moodboards, Storyboards or Filme of the chosen
 * project, each opening as its own document (browser modules beside this file). „Flows“ lists all documents.
 */
export const stepPages = [
  { id: 'moodboard', title: 'Moodboards', module: '/creativity-apps/flows/moodboard.js', description: 'Die Moodboards des Projekts, jedes eine freie Pinnwand mit @Look',
    icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
  { id: 'storyboard', title: 'Storyboards', module: '/creativity-apps/flows/storyboard.js', description: 'Die Storyboards des Projekts: Regie, Szenen und Filmstreifen',
    icon: 'M4 5h16v14H4zM4 9h16M4 15h16M8 5v4M12 5v4M16 5v4M8 15v4M12 15v4M16 15v4' },
  { id: 'filme', title: 'Filme', module: '/creativity-apps/flows/film.js', description: 'Die Filme des Projekts: Szenen aus dem Storyboard werden zu Videos und zum Schnitt',
    icon: 'M4 6h16v12H4zM10 9l5 3-5 3z' },
]

const base = '/creativity-flows/api'
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Framings a scene can have, as in a storyboard. */
export const shotSizes = ['Totale', 'Halbtotale', 'Amerikanisch', 'Halbnahe', 'Nahaufnahme', 'Großaufnahme', 'Detail']

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
    { type: 'scene', title: 'Szene', group: 'board', icon: 'shot', prompt: true, description: 'Eine Einstellung des Storyboards: was passiert, in welcher Einstellungsgröße, wie lange, mit welchem Startbild.',
      inputs: [], outputs: [{ id: 'text', kind: 'text', label: 'Szenenprompt' }, { id: 'image', kind: 'image', label: 'Startbild' }],
      fields: async () => [{ key: 'assetIds', label: 'Startbild', type: 'assets', single: true },
        { key: 'shot', label: 'Einstellung', type: 'enum', options: shotSizes, default: 'Halbnahe' },
        { key: 'duration', label: 'Dauer (s)', type: 'enum', options: ['4', '5', '6', '8', '10', '12', '15'], default: '5' }],
      // The framing leads the text, so storyboard pictures and clips get it without a separate input.
      resolve: ({ params, prompt }) => ({ text: text(shotSizes.includes(params.shot) && prompt.trim() ? `${params.shot}: ${prompt}` : prompt), image: assetOutputs(ids(params.assetIds).slice(0, 1)).image }) },
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
 * Adds the Library entries behind every media value of the view and every file chosen in a node's settings
 * (`canvasNodes`), so the editor can show previews without a request per asset. Entries deleted from the Library are
 * left out.
 * @returns {{ nodes: object, assets: Record<string, object> }}
 */
function withAssets(store, nodes, canvasNodes = []) {
  const ids = new Set()
  // Files chosen in a node's settings (a character sheet's outfit pictures, `…Ids`) are shown as well.
  for (const node of canvasNodes) {
    for (const [key, value] of Object.entries(node.params ?? {})) {
      if (/Ids$/.test(key) && Array.isArray(value)) for (const id of value) if (typeof id === 'string') ids.add(id)
    }
  }
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

/** A document's entry with the number of nodes and up to four pictures for its card. */
function summary(store, projectId, doc, state) {
  const nodes = store.appData(projectId, docKey(doc.id)).data.nodes ?? []
  const ids = []
  for (const node of nodes) {
    ids.push(...(node.params?.items ?? []).filter(item => item.kind === 'file').map(item => item.assetId), ...(node.params?.assetIds ?? []))
    for (const [port, values] of Object.entries(state[node.id]?.outputs ?? {})) if (port !== 'text' && Array.isArray(values)) ids.push(...values)
  }
  const cover = []
  for (const id of new Set(ids)) {
    if (cover.length >= 4) break
    try { if (/^image\//.test(store.asset(id).media_type ?? '')) cover.push(id) } catch (error) { if (!(error instanceof InputError)) throw error }
  }
  return { ...doc, nodes: nodes.filter(node => node.type !== 'frame').length, cover }
}

/** HTTP handler for the routes listed in the module comment. */
export function createHandler(store, registry, engine) {
  const known = type => Boolean(registry.node(type))
  const videoFields = async () => {
    const type = registry.node('video')
    if (!type) throw new InputError('Der Video Playground ist nicht geladen, daher gibt es keinen Video-Knoten.', 409)
    return type.fields()
  }
  /** What the hand-off needs: the storyboard's picture nodes and the params of a new Video node for a clip length. */
  const handoffEnv = fields => {
    const model = fields.find(field => field.key === 'modelId')?.default
    const video = seconds => {
      const field = fields.find(item => item.key === 'duration' && (!item.model || item.model === model))
      const values = (field?.options ?? []).map(option => (typeof option === 'object' ? option.value : option))
      const duration = values.length ? values.reduce((best, value) => (Math.abs(Number(value) - seconds) < Math.abs(Number(best) - seconds) ? value : best)) : undefined
      return { ...(model && { modelId: model }), ...(duration !== undefined && (field.model ? { settings: { [model]: { duration } } } : { duration })) }
    }
    const isPicture = node => { const kind = registry.node(node.type); return Boolean(kind?.run) && kind.outputs.every(port => port.kind === 'image') }
    return { store, engine, isPicture, video }
  }
  return async (req, res) => {
    const { json, send } = responder(req, res)
    try {
      const path = new URL(req.url, 'http://localhost').pathname.slice(base.length)
      const method = req.method
      if (['POST', 'PATCH', 'DELETE'].includes(method) && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new InputError('Schreibzugriff aus dieser Quelle ist gesperrt.', 403)
      if (method === 'GET' && path === '/nodes') return json(await describe(registry))
      if (method === 'GET' && path === '/templates') return json(templates.map(({ id, title, description, steps, kind, listed = true }) => ({ id, title, description, steps, kind, listed })))
      const list = new RegExp(`^/projects/(${uuid})/documents$`).exec(path)
      if (list && method === 'GET') {
        const state = store.settings('flows:state:' + list[1])
        const docs = listDocs(store, list[1]).map(doc => summary(store, list[1], doc, state))
        return json({ docs, assets: Object.fromEntries([...new Set(docs.flatMap(doc => doc.cover))].map(id => [id, store.asset(id)])) })
      }
      if (list && method === 'POST') {
        const body = await readBody(req)
        if (body.templateId !== undefined && typeof body.templateId !== 'string') throw new InputError('Wähle eine Vorlage.')
        if (body.templateId === undefined && !kinds[body.kind]) throw new InputError('Wähle, was du anlegen willst.')
        const made = createFromTemplate(store, list[1], body, known)
        // A template with `handoff` gives its storyboard's scenes to a film right away, as „An Film übergeben“ would.
        const board = templates.find(item => item.id === body.templateId)?.handoff && made.docs.find(doc => doc.kind === 'storyboard')
        if (board) {
          const scenes = readingOrder((store.appData(list[1], docKey(board.id)).data.nodes ?? []).filter(node => node.type === 'scene')).map(node => node.id)
          made.docs.push(handOff(handoffEnv(await videoFields()), list[1], board.id, scenes).doc)
        }
        return json(made, 201)
      }
      const one = new RegExp(`^/projects/(${uuid})/documents/([a-z0-9]+)(/duplicate|/split|/handoff)?$`).exec(path)
      if (one) {
        const [, projectId, docId, action] = one
        checkDocId(docId)
        if (method === 'PATCH' && !action) return json(renameDoc(store, projectId, docId, (await readBody(req)).title))
        if (method === 'DELETE' && !action) { deleteDoc(store, projectId, docId); return send(204, 'text/plain', '') }
        if (method === 'POST' && action === '/duplicate') { await readBody(req); return json(duplicateDoc(store, projectId, docId), 201) }
        if (method === 'POST' && action === '/handoff') {
          const { sceneIds } = await readBody(req)
          if (!Array.isArray(sceneIds) || sceneIds.length > 64 || !sceneIds.every(id => typeof id === 'string' && idPattern.test(id))) throw new InputError('Wähle Szenen aus dem Storyboard.')
          return json(handOff(handoffEnv(await videoFields()), projectId, docId, sceneIds), 201)
        }
        if (method === 'POST' && action === '/split') { await readBody(req); return json({ docs: splitDoc(store, projectId, docId, node => Boolean(registry.node(node.type)?.contains)) }, 201) }
      }
      // State, run and pick of one document; without `/documents/<doc>` they address the former single canvas.
      const scoped = new RegExp(`^/projects/(${uuid})(?:/documents/([a-z0-9]+))?(/state|/run|/nodes/([a-z0-9-]+)/pick)$`).exec(path)
      if (scoped) {
        const [, projectId, docId = 'flow', action, nodeId] = scoped
        if (docId !== 'flow') getDoc(store, projectId, docId)
        const canvas = () => store.appData(projectId, docKey(docId)).data.nodes ?? []
        if (method === 'GET' && action === '/state') return json({ ...withAssets(store, engine.view(projectId, docId), canvas()), projectAssets: engine.foreignAssets(projectId, docId) })
        if (method === 'POST' && action === '/run') {
          const body = await readBody(req)
          const valid = id => typeof id === 'string' && idPattern.test(id)
          if (!(valid(body.nodeId) || (Array.isArray(body.nodeId) && body.nodeId.length <= 64 && body.nodeId.every(valid)))) throw new InputError('Wähle einen Knoten.')
          if (body.dryRun) return json({ steps: engine.plan(projectId, body.nodeId, body.scope ?? 'node', docId) })
          return json({ steps: engine.run(projectId, body.nodeId, body.scope ?? 'node', docId) }, 202)
        }
        if (method === 'POST' && nodeId) {
          const { index } = await readBody(req)
          if (!Number.isInteger(index)) throw new InputError('Wähle ein Ergebnis aus dem Verlauf.')
          engine.pick(projectId, nodeId, index, docId)
          return json({ ...withAssets(store, engine.view(projectId, docId), canvas()), projectAssets: engine.foreignAssets(projectId, docId) })
        }
      }
      const boards = new RegExp(`^/projects/(${uuid})/import-boards$`).exec(path)
      if (method === 'GET' && boards) return json({ nodes: boardsToFlow(store, boards[1]).nodes.length })
      if (method === 'POST' && boards) {
        await readBody(req)
        const canvas = boardsToFlow(store, boards[1])
        if (!canvas.nodes.length) throw new InputError('Es gibt kein altes Moodboard oder Storyboard zum Übernehmen.', 409)
        return json({ docs: [createDoc(store, boards[1], { kind: 'flow', title: 'Übernommene Boards', canvas })], skipped: [] }, 201)
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
  for (const page of stepPages) ctx.effect(() => ctx.creativeApps.register({ ...page, page: true }))
  const store = ctx.creativeStore
  const registry = ctx.creativeNodes
  for (const node of sourceNodes(store)) ctx.effect(() => registry.register(node))
  const engine = createEngine(store, registry)
  ctx.effect(() => () => engine.stop())
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/creativity-flows', auth: 'required', handler: createHandler(store, registry, engine) }))
}
