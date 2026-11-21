/**
 * Documents of a project: every moodboard, storyboard, film and free flow is a document of its own,
 * like a flow in ElevenLabs or a board in Milanote. Templates create new documents and never fill an open one.
 *
 * Storage: the index is `app_data(flows)` = `{ docs: [{ id, kind, title, createdAt, updatedAt }] }`; the canvas of a
 * document is `app_data(flow-<id>)` (`{ nodes, edges }`, written by the editor through the hub API). The canvas a
 * project had before documents (`app_data(flow)`) becomes the document `flow` („Flow“) the first time the index is
 * read; it is not copied or changed. Run state stays per project (`flows:state:<project>`), keyed by node id.
 */
import { randomUUID } from 'node:crypto'
import { InputError } from '../../../store.mjs'

/** Kinds of documents, in the order the project shows them. */
export const kinds = {
  moodboard: { title: 'Moodboard', plural: 'Moodboards' },
  storyboard: { title: 'Storyboard', plural: 'Storyboards' },
  film: { title: 'Film', plural: 'Filme' },
  flow: { title: 'Flow', plural: 'Flows' },
  // Documents made before the character studio moved into the storyboard; no longer created.
  cast: { title: 'Figur und Set', plural: 'Figuren und Sets' },
}

const indexKey = 'flows'
const legacyKey = 'flow'
const docPattern = /^(flow|[0-9a-f]{12})$/

/** App-data key of a document's canvas. */
export const docKey = id => (id === legacyKey ? legacyKey : 'flow-' + id)

/** Throws unless `id` can name a document. */
export function checkDocId(id) {
  if (typeof id !== 'string' || !docPattern.test(id)) throw new InputError('Unbekanntes Dokument.', 404)
  return id
}

const now = () => new Date().toISOString()

/**
 * The project's documents. A project with only the former single canvas gets it as the document „Flow“.
 * @returns {{ id: string, kind: string, title: string, createdAt: string, updatedAt: string }[]}
 */
export function listDocs(store, projectId) {
  const index = store.appData(projectId, indexKey)
  if (index.revision) return index.data.docs ?? []
  const legacy = store.appData(projectId, legacyKey)
  if (!legacy.data.nodes?.length) return []
  const docs = [{ id: legacyKey, kind: 'flow', title: 'Flow', createdAt: now(), updatedAt: now() }]
  store.setAppData(projectId, indexKey, { revision: 0, data: { docs } })
  return docs
}

/** One document of the project; throws 404 when it is not in the index. */
export function getDoc(store, projectId, id) {
  checkDocId(id)
  const doc = listDocs(store, projectId).find(item => item.id === id)
  if (!doc) throw new InputError('Dieses Dokument gibt es in diesem Projekt nicht.', 404)
  return doc
}

function writeIndex(store, projectId, change) {
  listDocs(store, projectId)
  const index = store.appData(projectId, indexKey)
  const docs = change(index.data.docs ?? [])
  store.setAppData(projectId, indexKey, { revision: index.revision, data: { docs } })
  return docs
}

/** A title that no other document of the project has („Moodboard 2“ next to „Moodboard“). */
export function freeTitle(docs, wanted) {
  const taken = new Set(docs.map(doc => doc.title.toLocaleLowerCase('de')))
  if (!taken.has(wanted.toLocaleLowerCase('de'))) return wanted
  let n = 2
  while (taken.has(`${wanted} ${n}`.toLocaleLowerCase('de'))) n++
  return `${wanted} ${n}`
}

/**
 * Creates a document with its canvas.
 * @param {{ kind: string, title?: string, canvas?: { nodes: object[], edges: object[] }, source?: string }} spec `source`: the
 *   storyboard a film is made from.
 * @returns {object} the new index entry.
 */
export function createDoc(store, projectId, { kind, title, canvas = { nodes: [], edges: [] }, source }) {
  if (!kinds[kind]) throw new InputError('Unbekannte Dokumentart.')
  const id = randomUUID().replace(/-/g, '').slice(0, 12)
  let entry
  writeIndex(store, projectId, docs => {
    entry = { id, kind, title: freeTitle(docs, String(title ?? '').trim().slice(0, 60) || kinds[kind].title), ...(source && { source }), createdAt: now(), updatedAt: now() }
    return [...docs, entry]
  })
  store.setAppData(projectId, docKey(id), { revision: 0, data: canvas })
  return entry
}

/** Renames a document; titles stay unique in the project. */
export function renameDoc(store, projectId, id, title) {
  getDoc(store, projectId, id)
  const clean = String(title ?? '').trim().slice(0, 60)
  if (!clean) throw new InputError('Gib dem Dokument einen Namen.')
  let entry
  writeIndex(store, projectId, docs => docs.map(doc => {
    if (doc.id !== id) return doc
    entry = { ...doc, title: freeTitle(docs.filter(other => other.id !== id), clean), updatedAt: now() }
    return entry
  }))
  return entry
}

/** Marks a document as changed now (the list sorts by it). */
export function touchDoc(store, projectId, id) {
  writeIndex(store, projectId, docs => docs.map(doc => (doc.id === id ? { ...doc, updatedAt: now() } : doc)))
}

/** Removes a document from the project and empties its canvas. Results in the Library stay. */
export function deleteDoc(store, projectId, id) {
  getDoc(store, projectId, id)
  writeIndex(store, projectId, docs => docs.filter(doc => doc.id !== id))
  const canvas = store.appData(projectId, docKey(id))
  store.setAppData(projectId, docKey(id), { revision: canvas.revision, data: { nodes: [], edges: [] } })
}

/** Copies a document with fresh node ids; the copy's project assets get free names so mentions stay unique. */
export function duplicateDoc(store, projectId, id) {
  const doc = getDoc(store, projectId, id)
  const canvas = store.appData(projectId, docKey(id)).data
  const ids = new Map((canvas.nodes ?? []).map(node => [node.id, randomUUID()]))
  const nodes = (canvas.nodes ?? []).map(node => ({ ...node, id: ids.get(node.id), ...(node.parentId && { parentId: ids.get(node.parentId) }),
    ...(node.params?.from && { params: { ...node.params, from: ids.get(node.params.from) ?? node.params.from } }) }))
  const edges = (canvas.edges ?? []).map(edge => ({ ...edge, id: randomUUID(), source: ids.get(edge.source), target: ids.get(edge.target) }))
  const renamed = uniqueAssets(store, projectId, { nodes, edges })
  return createDoc(store, projectId, { kind: doc.kind, title: doc.title + ' Kopie', canvas: renamed })
}

/** Names of the project assets in every document, for keeping new asset names unique. */
export function assetNames(store, projectId, nameOf) {
  return listDocs(store, projectId).flatMap(doc => (store.appData(projectId, docKey(doc.id)).data.nodes ?? []).filter(node => node.asset).map(nameOf ?? (node => String(node.name ?? '').trim())))
}

/**
 * Gives the project assets of new canvases names that no document of the project uses yet („Look 2“) and carries the
 * new names into their `@` mentions. Several canvases made together (a template) are renamed as one.
 * @param {{ nodes: object[], edges: object[] } | { nodes: object[], edges: object[] }[]} canvases
 */
export function uniqueAssets(store, projectId, canvases) {
  const list = Array.isArray(canvases) ? canvases : [canvases]
  const taken = new Set(assetNames(store, projectId).map(name => name.toLocaleLowerCase('de')))
  const renames = []
  for (const canvas of list) {
    for (const node of canvas.nodes) {
      const name = String(node.name ?? '').trim()
      if (!node.asset || !name || !taken.has(name.toLocaleLowerCase('de'))) { if (node.asset && name) taken.add(name.toLocaleLowerCase('de')); continue }
      let n = 2
      while (taken.has(`${name} ${n}`.toLocaleLowerCase('de'))) n++
      renames.push([name, `${name} ${n}`])
      taken.add(`${name} ${n}`.toLocaleLowerCase('de'))
    }
  }
  if (!renames.length) return canvases
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const carry = text => (typeof text === 'string' ? renames.reduce((out, [from, to]) => out.replace(new RegExp('@' + escape(from) + '(?![\\p{L}\\p{N}_])', 'gu'), '@' + to), text) : text)
  const rename = canvas => ({ ...canvas, nodes: canvas.nodes.map(node => {
    const hit = node.asset && renames.find(([from]) => from === String(node.name ?? '').trim())
    return { ...node, ...(hit && { name: hit[1] }), prompt: carry(node.prompt),
      ...(node.params && { params: Object.fromEntries(Object.entries(node.params).map(([key, value]) => [key, carry(value)])) }) }
  }) })
  return Array.isArray(canvases) ? list.map(rename) : rename(list[0])
}

/**
 * Project assets of the other documents, so `@Look` from a moodboard works in a storyboard. They come with the
 * document they live in (`foreign`); the engine reads their results but never runs them from another document.
 */
export function foreignAssets(store, projectId, exceptId) {
  return listDocs(store, projectId).filter(doc => doc.id !== exceptId).flatMap(doc =>
    (store.appData(projectId, docKey(doc.id)).data.nodes ?? []).filter(node => node.asset).map(node => {
      const { parentId, ...rest } = node
      return { ...rest, x: -1e6, y: -1e6, foreign: { id: doc.id, title: doc.title, kind: doc.kind } }
    }))
}

const phaseKinds = { moodboard: 'moodboard', storyboard: 'storyboard', cast: 'cast' }
const phaseNames = [[/mood/i, 'moodboard'], [/story/i, 'storyboard'], [/figur|set\b|cast/i, 'cast']]

/**
 * Splits a canvas that holds several phases (frames) into documents: every frame becomes a document of its kind
 * (Moodboard, Storyboard, Figur und Set; other frames become flows) with its content at canvas positions. Lines
 * between frames are dropped; project assets keep the documents connected through `@` mentions. What lies outside
 * frames stays in the document.
 * @param {(node: object) => boolean} isFrame
 * @returns {object[]} the new index entries, in frame order.
 */
export function splitDoc(store, projectId, id, isFrame) {
  getDoc(store, projectId, id)
  const record = store.appData(projectId, docKey(id))
  const nodes = record.data.nodes ?? []
  const edges = record.data.edges ?? []
  const frames = nodes.filter(isFrame).sort((a, b) => (a.x - b.x) || (a.y - b.y))
  if (!frames.length) throw new InputError('In diesem Dokument gibt es keine Rahmen zum Aufteilen.')
  const moved = new Set()
  const made = []
  for (const frame of frames) {
    const inside = nodes.filter(node => node.parentId === frame.id)
    const ids = new Set(inside.map(node => node.id))
    const phase = frame.params?.phase ?? phaseNames.find(([pattern]) => pattern.test(String(frame.name ?? '')))?.[1]
    const kind = phaseKinds[phase] ?? 'flow'
    const canvas = {
      nodes: inside.map(node => { const { parentId, ...rest } = node; return { ...rest, x: node.x, y: node.y } }),
      edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
    }
    made.push(createDoc(store, projectId, { kind, title: String(frame.name ?? '').replace(/^\d+\s*·\s*/, '') || kinds[kind].title, canvas }))
    moved.add(frame.id)
    for (const node of inside) moved.add(node.id)
  }
  store.setAppData(projectId, docKey(id), { revision: record.revision, data: {
    nodes: nodes.filter(node => !moved.has(node.id)),
    edges: edges.filter(edge => !moved.has(edge.source) && !moved.has(edge.target)),
  } })
  touchDoc(store, projectId, id)
  return made
}
