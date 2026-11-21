/**
 * Templates: each creates new documents in the project (see `documents.mjs`); none adds to an open canvas. A template
 * lists documents with their nodes (local keys) and edges; `createFromTemplate` gives the nodes fresh ids, fills Datei
 * nodes and moodboards from the Library (`find`/`board`: search words, the project's own files first) and gives project
 * assets names the project does not use yet. Documents made together reach each other through `@` mentions.
 *
 * Templates only arrange nodes. Nothing runs on creation; paid nodes still start only on a click.
 */
import { randomUUID } from 'node:crypto'
import { InputError } from '../../../store.mjs'
import { createDoc, uniqueAssets } from './documents.mjs'
import { adoptIntoFrames } from './frames.mjs'

const W = 352 // column width of a node plus gap
/** A frame inside a document; `phase` (shots, edit) lets the film strip find the frame for new keyframes and videos. */
const frame = (key, name, x, y, width, height, phase) => ({ key, type: 'frame', name, x, y, params: { width, height, ...(phase && { phase }) } })
const files = (key, name, x, y, find, count = 4) => ({ key, type: 'library', name, x, y, find, count })
const scene = (key, name, x, y, prompt, duration) => ({ key, type: 'scene', name, x, y, prompt, params: { duration: String(duration), from: 'regie' } })
const link = (source, sourceHandle, target, targetHandle) => ({ source, sourceHandle, target, targetHandle })

/** Board of the moodboard template: eight pictures from the Library in a 4 × 2 grid, beside them a note, keywords and two colours. */
const boardWidth = 976
const boardHeight = 528
const boardPictures = [['Outfit', 3], ['Location', 3], ['Person', 2]]
const boardItems = [
  { kind: 'note', x: 768, y: 16, text: 'Analoger Film, sichtbares Korn, harte Schatten. Glänzendes Latex gegen kalte Klinikfliesen, einzelne Neonakzente. Ruhige, lange Einstellungen.' },
  ...['Latex', 'Klinik', 'Neon', 'Korn', '35 mm'].map((text, i) => ({ kind: 'word', x: 768 + (i % 2) * 104, y: 176 + Math.floor(i / 2) * 44, text })),
  { kind: 'color', x: 768, y: 336, color: '#B3122E' },
  { kind: 'color', x: 872, y: 336, color: '#5E7A82' },
]

/** Moodboard document: one free pinboard (pictures, a note, keywords, colours). „Look erzeugen“ makes @Look. */
function moodboard() {
  return { nodes: [{ key: 'look', type: 'moodboard', name: 'Look', asset: true, x: 0, y: 0, prompt: '', board: boardPictures, params: { width: boardWidth, height: boardHeight, items: boardItems } }], edges: [] }
}

const story = 'Eine Frau im schwarzen Latexmantel wacht in einer verlassenen Klinik auf. Sie folgt einem flackernden Neonlicht durch den Flur und spricht am Ende direkt in die Kamera.'
const exampleScenes = [
  ['s1', 'Erwachen', 6, 'Totale: @Figur liegt in @Set auf einer Metallliege und richtet sich langsam auf. Bewegung: Staub in der Luft, die Kamera steht.'],
  ['s2', 'Flur', 8, 'Halbnahe: @Figur geht durch @Set, ein Neonrohr flackert über ihr. Bewegung: Kamerafahrt rückwärts vor ihr her.'],
  ['s3', 'Ansprache', 10, 'Nahaufnahme: @Figur bleibt in @Set stehen, sieht in die Kamera und spricht. Bewegung: langsamer Zoom, Gegenlicht aus der offenen Tür.'],
]

/**
 * Storyboard document: Regie holds the story and writes the shot list; the scenes beside it are examples that
 * „Szenen anlegen“ replaces. The film strip below shows them. `look` mentions the moodboard's @Look.
 */
function storyboard({ look = false } = {}) {
  return {
    nodes: [
      { key: 'regie', type: 'director', name: 'Regie', x: 0, y: 0,
        // Regie gets the names of all project assets (@Figur, @Set …) with its request; mentioning them here would make it
        // wait for the rendered sheet and set.
        prompt: 'Teile die Story in drei Einstellungen von 5 bis 10 Sekunden. Die Frau ist die Figur, der Ort das Set.' + (look ? ' Halte dich an @Look.' : ''), params: { story } },
      ...exampleScenes.map(([key, name, seconds, prompt], i) => scene(key, name, 384 + i * 304, 0, prompt, seconds)),
    ],
    edges: [],
  }
}

/** Figur-und-Set document: outfits and places as references beside the sheet and the set made from them, all four project assets. */
function cast({ look = false } = {}) {
  return {
    nodes: [
      { ...files('outfits', 'Outfits', 0, 0, 'Outfit', 4), asset: true },
      { key: 'figur', type: 'character', name: 'Figur', asset: true, x: W, y: 0,
        prompt: 'Frau Anfang 30, kantiges Gesicht, helle Haut mit feinen Sommersprossen, schwarzer Bob, kleine Narbe über der linken Augenbraue. Outfit-Details aus @Outfits.' + (look ? ' Look aus @Look.' : ''),
        params: { outfit: 'Knielanger schwarzer Latexmantel mit hohem Kragen, schwarze Latexhandschuhe, kniehohe Lackstiefel. Rücken: durchgehender Reißverschluss.', head: 'cropped', mouth: true } },
      { ...files('orte', 'Orte', 2 * W, 0, 'Location', 4), asset: true },
      { key: 'set', type: 'set', name: 'Set', asset: true, x: 3 * W, y: 0,
        prompt: 'Verlassener Klinikflur mit weißen Fliesen, Metalltüren und einem flackernden Neonrohr, angelehnt an @Orte.' + (look ? ' Look aus @Look.' : ' Analoger Film, Korn.') },
    ],
    edges: [],
  }
}

/**
 * Film document: the storyboard with, per scene, a keyframe (Bild) as start image of a clip (Video), and the cut. The
 * scene text feeds keyframe and clip and names @Figur and @Set from the Figur-und-Set document; the keyframe adds
 * @Look. So figure, outfit and place stay the same from shot to shot.
 */
function film() {
  const base = storyboard({ look: true })
  const x = 384 + 3 * 304 + 160
  const nodes = [...base.nodes, frame('dreh', 'Keyframes und Videos', x, -72, 2 * W + 64, 72 + exampleScenes.length * 760, 'shots')]
  const edges = []
  exampleScenes.forEach(([sceneKey, name, seconds], i) => {
    const row = i * 760
    nodes.push(
      { key: 'k' + i, type: 'image', name: 'Keyframe ' + name, x: x + 32, y: row,
        prompt: 'Standbild dieser Einstellung im Format 16:9. Gleiche Figur, gleiches Outfit, gleicher Ort wie in den Referenzen. Look aus @Look.' },
      { key: 'v' + i, type: 'video', name: 'Video ' + name, x: x + 32 + W, y: row, prompt: 'Die Figur und der Ort bleiben genau wie im Startbild.',
        params: { modelId: 'seedance', settings: { seedance: { duration: String(seconds), resolution: '720p', aspect: '16:9', audio: true } } } },
    )
    edges.push(link(sceneKey, 'text', 'k' + i, 'prompt'), link(sceneKey, 'text', 'v' + i, 'prompt'), link('k' + i, 'image', 'v' + i, 'start'))
  })
  const cut = x + 2 * W + 64 + 160
  nodes.push(frame('schnitt', 'Schnitt', cut, -72, W + 64, 880, 'edit'), { key: 'film', type: 'composition', name: 'Film', x: cut + 32, y: 0 })
  edges.push(...exampleScenes.map((_, i) => link('v' + i, 'video', 'film', 'clips')))
  return { nodes, edges }
}

/**
 * All templates: id, title, description, the steps they cover and the documents they create (`kind`, `title`,
 * canvas). `kind` without `docs` marks the template „Neu“ offers for that kind of document; `listed: false` keeps a
 * template out of the template list.
 */
export const templates = [
  { id: 'moodboard', title: 'Moodboard', kind: 'moodboard', steps: ['Moodboard'],
    description: 'Eine freie Pinnwand für Bilder, Farben, Notizen und Stichworte, ohne Kästen und Linien. „Look erzeugen“ macht daraus @Look mit Licht, Kamera, Palette und Leitbildern.',
    docs: () => [{ kind: 'moodboard', title: 'Moodboard', ...moodboard() }] },
  { id: 'storyboard', title: 'Storyboard', kind: 'storyboard', steps: ['Storyboard'],
    description: 'Die Regie mit deiner Story schreibt die Shotliste, „Szenen anlegen“ macht daraus die Szenen. Der Filmstreifen zeigt sie mit Dauer und Status.',
    docs: () => [{ kind: 'storyboard', title: 'Storyboard', ...storyboard() }] },
  { id: 'moodboard-und-storyboard', title: 'Moodboard und Storyboard', steps: ['Moodboard', 'Storyboard'],
    description: 'Zwei Dokumente, die zusammenarbeiten: Der Look aus dem Moodboard (@Look) geht in die Regie, die daraus und aus der Story die Szenen schreibt.',
    docs: () => [{ kind: 'moodboard', title: 'Moodboard', ...moodboard() }, { kind: 'storyboard', title: 'Storyboard', ...storyboard({ look: true }) }] },
  { id: 'konsistenter-film', title: 'Konsistenter Film', steps: ['Moodboard', 'Figur und Set', 'Film: Szenen, Keyframes, Videos, Schnitt'],
    description: 'Drei Dokumente für ein Video mit gleichbleibender Figur: Moodboard (@Look), Figur und Set (@Figur, @Set) und der Film mit Regie, Szenen, pro Szene Keyframe und Video, am Ende der Schnitt.',
    docs: () => [{ kind: 'moodboard', title: 'Moodboard', ...moodboard() }, { kind: 'cast', title: 'Figur und Set', ...cast({ look: true }) }, { kind: 'storyboard', title: 'Film', ...film() }] },
  { id: 'figur-und-set', title: 'Figur und Set', kind: 'cast', steps: ['Figur und Set'], listed: false,
    description: 'Outfits und Orte als Referenzen, daraus Charakterblatt und Set ohne Personen. Alle vier sind @Assets für gleichbleibende Figuren und Orte.',
    docs: () => [{ kind: 'cast', title: 'Figur und Set', ...cast() }] },
]

/** Empty documents per kind („Neu“ without a template): the one node that makes the kind, or nothing for a flow. */
export const blanks = {
  moodboard: () => ({ nodes: [{ key: 'look', type: 'moodboard', name: 'Look', asset: true, x: 0, y: 0, prompt: '', params: { width: boardWidth, height: boardHeight, items: [] } }], edges: [] }),
  storyboard: () => ({ nodes: [{ key: 'regie', type: 'director', name: 'Regie', x: 0, y: 0, prompt: 'Teile die Story in Einstellungen von 5 bis 10 Sekunden.', params: { story: '' } }], edges: [] }),
  cast: () => ({ nodes: [{ key: 'figur', type: 'character', name: 'Figur', asset: true, x: 0, y: 0, prompt: '' }, { key: 'set', type: 'set', name: 'Set', asset: true, x: W, y: 0, prompt: '' }], edges: [] }),
  flow: () => ({ nodes: [], edges: [] }),
}

/**
 * Creates the documents of a template (or one empty document of `kind`) in the project.
 * @param {{ templateId?: string, kind?: string, title?: string }} request
 * @param {(type: string) => boolean} known whether a node type is registered; unknown types are left out with their edges.
 * @returns {{ docs: object[], skipped: string[] }} the new index entries, the first one is the one to open.
 */
export function createFromTemplate(store, projectId, { templateId, kind, title }, known) {
  const template = templateId ? templates.find(item => item.id === templateId) : null
  if (templateId && !template) throw new InputError('Diese Vorlage gibt es nicht.', 404)
  if (!template && !blanks[kind]) throw new InputError('Unbekannte Dokumentart.')
  const specs = template ? template.docs() : [{ kind, title, ...blanks[kind]() }]
  const used = new Set()
  // Files for moodboards and Datei nodes: the project's own first, then the whole Library, each file only once.
  const pick = (words, count) => {
    const found = []
    for (const scope of [{ project: projectId }, {}]) {
      for (const item of store.search({ q: words, ...scope, limit: 40 }).items) {
        if (found.length >= count) break
        if (!used.has(item.id) && /^image\//.test(item.media_type ?? '')) { used.add(item.id); found.push(item.id) }
      }
    }
    return found
  }
  const pinned = groups => groups.flatMap(([words, count]) => pick(words, count)).map((assetId, k) => ({ kind: 'file', assetId, x: 16 + (k % 4) * 184, y: 16 + Math.floor(k / 4) * 256 }))
  const skipped = new Set()
  const canvases = specs.map(spec => {
    const ids = new Map(spec.nodes.map(node => [node.key, randomUUID()]))
    for (const node of spec.nodes) if (!known(node.type)) skipped.add(node.type)
    const nodes = spec.nodes.filter(node => known(node.type)).map(({ key, find, count, board, ...node }) => ({
      ...node, id: ids.get(key), x: Math.round(node.x), y: Math.round(node.y), prompt: node.prompt ?? '',
      params: { ...node.params, ...(node.type === 'library' && { assetIds: find ? pick(find, count) : [] }), ...(node.params?.from && { from: ids.get(node.params.from) }),
        ...(node.params?.items && { items: [...(board ? pinned(board) : []), ...node.params.items].map(item => ({ id: randomUUID(), ...item })) }) },
    }))
    const placed = new Set(nodes.map(node => node.id))
    const edges = spec.edges.map(edge => ({ id: randomUUID(), source: ids.get(edge.source), sourceHandle: edge.sourceHandle, target: ids.get(edge.target), targetHandle: edge.targetHandle }))
      .filter(edge => placed.has(edge.source) && placed.has(edge.target))
    return adoptIntoFrames({ nodes, edges }, node => node.type === 'frame').doc
  })
  const named = uniqueAssets(store, projectId, canvases)
  const docs = specs.map((spec, i) => createDoc(store, projectId, { kind: spec.kind, title: spec.title, canvas: named[i] }))
  return { docs, skipped: [...skipped] }
}
