/**
 * Flow templates: ready canvases for a whole production or one phase of it. A template lists nodes with local keys
 * and edges between those keys; `insertTemplate` gives them fresh ids, places them right of the existing content and
 * fills Datei nodes from the Library (`find`: search words such as tags, the project's own files first).
 *
 * Templates only arrange nodes. Nothing runs on insertion; paid nodes still start only on a click.
 */
import { randomUUID } from 'node:crypto'
import { InputError } from '../../../store.mjs'
import { adoptIntoFrames } from './frames.mjs'

const W = 352 // column width of a node plus gap
/** A phase frame; `phase` (moodboard, storyboard, cast, voice, shots, edit) lets the step pages find it whatever its name. */
const frame = (key, name, x, y, width, height, phase) => ({ key, type: 'frame', name, x, y, params: { width, height, ...(phase && { phase }) } })
const files = (key, name, x, y, find, count = 4) => ({ key, type: 'library', name, x, y, find, count })
const scene = (key, name, x, y, prompt, duration) => ({ key, type: 'scene', name, x, y, prompt, params: { duration: String(duration) } })
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

/**
 * Moodboard phase: one free pinboard (pictures, a note, keywords, colours; no boxes and no lines inside). „Look
 * erzeugen“ on it makes the structured look; as project asset it is @Look for every later step.
 */
function moodboard(x, y) {
  return {
    nodes: [
      frame('mood', '1 · Moodboard', x, y, boardWidth + 64, 880, 'moodboard'),
      { key: 'look', type: 'moodboard', name: 'Look', asset: true, x: x + 32, y: y + 72, prompt: '',
        board: boardPictures, params: { width: boardWidth, height: boardHeight, items: boardItems } },
    ],
    edges: [],
  }
}
/** Width the moodboard phase takes. */
const moodWidth = boardWidth + 64

/**
 * Storyboard phase: Regie holds the story itself and writes the shot list from it and @Look; „Szenen anlegen“ turns
 * the shots into the scenes beside it, which also fill the film strip. The three scenes here are examples that Regie
 * updates.
 */
function storyboard(x, y, mood = true) {
  return {
    nodes: [
      frame('story', '2 · Storyboard', x, y, storyWidth, 880, 'storyboard'),
      { key: 'regie', type: 'director', name: 'Regie', x: x + 32, y: y + 72,
        // Regie gets the names of all project assets (@Figur, @Set …) with its request; mentioning them here would make it
        // wait for the rendered sheet and set.
        prompt: 'Teile die Story in drei Einstellungen von 5 bis 10 Sekunden. Die Frau ist die Figur, der Ort das Set.' + (mood ? ' Halte dich an @Look.' : ''),
        params: { story: 'Eine Frau im schwarzen Latexmantel wacht in einer verlassenen Klinik auf. Sie folgt einem flackernden Neonlicht durch den Flur und spricht am Ende direkt in die Kamera.' } },
      scene('s1', 'Erwachen', x + 32 + 384, y + 72, 'Totale: @Figur liegt in @Set auf einer Metallliege und richtet sich langsam auf. Bewegung: Staub in der Luft, die Kamera steht.', 6),
      scene('s2', 'Flur', x + 32 + 384 + 304, y + 72, 'Halbnahe: @Figur geht durch @Set, ein Neonrohr flackert über ihr. Bewegung: Kamerafahrt rückwärts vor ihr her.', 8),
      scene('s3', 'Ansprache', x + 32 + 384 + 2 * 304, y + 72, 'Nahaufnahme: @Figur bleibt in @Set stehen, sieht in die Kamera und spricht. Bewegung: langsamer Zoom, Gegenlicht aus der offenen Tür.', 10),
    ].map(node => (node.type === 'scene' ? { ...node, params: { ...node.params, from: 'regie' } } : node)),
    edges: [],
  }
}

/**
 * Character and set phase: the references (outfits, places) beside what is made from them, the reference sheet and the
 * set without people. All four are project assets (@Outfits, @Figur, @Orte, @Set), so no line leaves the frame.
 */
function cast(x, y, mood = true) {
  return {
    nodes: [
      frame('cast', '3 · Figur und Set', x, y, 4 * W + 64, 880, 'cast'),
      { ...files('outfits', 'Outfits', x + 32, y + 72, 'Outfit', 4), asset: true },
      { key: 'figur', type: 'character', name: 'Figur', asset: true, x: x + 32 + W, y: y + 72,
        prompt: 'Frau Anfang 30, kantiges Gesicht, helle Haut mit feinen Sommersprossen, schwarzer Bob, kleine Narbe über der linken Augenbraue. Outfit-Details aus @Outfits.' + (mood ? ' Look aus @Look.' : ''),
        params: { outfit: 'Knielanger schwarzer Latexmantel mit hohem Kragen, schwarze Latexhandschuhe, kniehohe Lackstiefel. Rücken: durchgehender Reißverschluss.', head: 'cropped', mouth: true } },
      { ...files('orte', 'Orte', x + 32 + 2 * W, y + 72, 'Location', 4), asset: true },
      { key: 'set', type: 'set', name: 'Set', asset: true, x: x + 32 + 3 * W, y: y + 72,
        prompt: 'Verlassener Klinikflur mit weißen Fliesen, Metalltüren und einem flackernden Neonrohr, angelehnt an @Orte.' + (mood ? ' Look aus @Look.' : ' Analoger Film, Korn.') },
    ],
    edges: [],
  }
}

/**
 * Shot phase: per scene one row with a keyframe (Bild) and a clip (Video). The scene text feeds both; it names @Figur
 * and @Set, which arrive as references, and the keyframe adds @Look. The keyframe is the clip's start image, so figure,
 * outfit and place stay the same from shot to shot.
 */
function shots(x, y, scenes) {
  const nodes = [frame('dreh', '4 · Keyframes und Videos', x, y, 2 * W + 64, 72 + scenes.length * 760, 'shots')]
  const edges = []
  scenes.forEach(([sceneKey, name, seconds], i) => {
    const row = y + 72 + i * 760
    nodes.push(
      { key: 'k' + i, type: 'image', name: 'Keyframe ' + name, x: x + 32, y: row,
        prompt: 'Standbild dieser Einstellung im Format 16:9. Gleiche Figur, gleiches Outfit, gleicher Ort wie in den Referenzen. Look aus @Look.' },
      { key: 'v' + i, type: 'video', name: 'Video ' + name, x: x + 32 + W, y: row,
        prompt: 'Die Figur und der Ort bleiben genau wie im Startbild.',
        params: { modelId: 'seedance', settings: { seedance: { duration: String(seconds), resolution: '720p', aspect: '16:9', audio: true } } } },
    )
    edges.push(link(sceneKey, 'text', 'k' + i, 'prompt'), link(sceneKey, 'text', 'v' + i, 'prompt'), link('k' + i, 'image', 'v' + i, 'start'))
  })
  return { nodes, edges }
}

/** Edit phase: the clips in reading order become the film. */
function edit(x, y, clips) {
  return {
    nodes: [frame('schnitt', '5 · Schnitt', x, y, W + 64, 880, 'edit'), { key: 'film', type: 'composition', name: 'Film', x: x + 32, y: y + 72 }],
    edges: clips.map(key => link(key, 'video', 'film', 'clips')),
  }
}

const merge = (...parts) => ({ nodes: parts.flatMap(part => part.nodes), edges: parts.flatMap(part => part.edges) })
const storyWidth = 384 + 3 * 304 + 64
const exampleScenes = [['s1', 'Erwachen', 6], ['s2', 'Flur', 8], ['s3', 'Ansprache', 10]]

/**
 * All templates: id, title, description and a builder returning nodes and edges at the origin. `phase` marks the
 * template a step page offers when its phase is missing; `listed: false` keeps a template out of the template dialog.
 */
export const templates = [
  { id: 'moodboard', title: 'Moodboard', phases: 1, steps: ['Moodboard'], phase: 'moodboard',
    description: 'Eine freie Pinnwand für Bilder, Farben, Notizen und Stichworte, ohne Kästen und Linien. „Look erzeugen“ macht daraus @Look mit Licht, Kamera, Palette und Leitbildern.',
    build: () => moodboard(0, 0) },
  { id: 'storyboard', title: 'Storyboard', phases: 1, steps: ['Storyboard'], phase: 'storyboard',
    description: 'Die Regie mit deiner Story schreibt die Shotliste, „Szenen anlegen“ macht daraus die Szenen. Der Filmstreifen zeigt sie mit Dauer und Status.',
    build: () => storyboard(0, 0, false) },
  { id: 'moodboard-und-storyboard', title: 'Moodboard und Storyboard', phases: 2, steps: ['Moodboard', 'Storyboard'],
    description: 'Beides zusammen: Der Look aus dem Moodboard (@Look) geht in die Regie, die daraus und aus der Story die Szenen schreibt. Ohne Linie zwischen den Rahmen.',
    build: () => merge(moodboard(0, 0), storyboard(moodWidth + 160, 0)) },
  { id: 'konsistenter-film', title: 'Konsistenter Film', phases: 5, steps: ['Moodboard', 'Storyboard', 'Figur und Set', 'Keyframes und Videos', 'Schnitt'],
    description: 'Der ganze Weg zum Video: Moodboard (@Look), Storyboard mit Regie, Figur und Set als @Assets, pro Szene ein Keyframe als Startbild und ein Video, am Ende der Schnitt. Figur, Outfit und Ort bleiben in jeder Einstellung gleich.',
    build: () => {
      const at = [0, moodWidth + 160]
      for (const width of [storyWidth, 4 * W + 64, 2 * W + 64]) at.push(at.at(-1) + width + 160)
      return merge(moodboard(at[0], 0), storyboard(at[1], 0), cast(at[2], 0), shots(at[3], 0, exampleScenes), edit(at[4], 0, exampleScenes.map((_, i) => 'v' + i)))
    } },
  { id: 'figur-und-set', title: 'Figur und Set', phases: 1, steps: ['Figur und Set'], phase: 'cast', listed: false,
    description: 'Outfits und Orte als Referenzen, daraus Charakterblatt und Set ohne Personen. Alle vier sind @Assets für gleichbleibende Figuren und Orte.',
    build: () => cast(0, 0, false) },
]

/**
 * Places a template in the project's flow, right of what is already there, and stores it.
 * @param {(type: string) => boolean} known whether a node type is registered; unknown types are left out with their edges.
 * @returns {{ record: { data: object, revision: number }, added: number, skipped: string[] }}
 */
export function insertTemplate(store, projectId, templateId, revision, known) {
  const template = templates.find(item => item.id === templateId)
  if (!template) throw new InputError('Diese Vorlage gibt es nicht.', 404)
  const current = store.appData(projectId, 'flow')
  if (current.revision !== revision) throw new InputError('Der Flow wurde inzwischen geändert. Lade die Seite neu und versuche es erneut.', 409)
  const data = { nodes: [], edges: [], ...current.data }
  const { nodes, edges } = template.build()
  const skipped = [...new Set(nodes.filter(node => !known(node.type)).map(node => node.type))]
  // Top-level nodes carry canvas positions; children of frames lie within their frame.
  const outer = data.nodes.filter(node => !node.parentId)
  const right = outer.length ? Math.max(...outer.map(node => node.x + (node.params?.width ?? 320))) + 320 : 0
  const top = outer.length ? Math.min(...outer.map(node => node.y)) : 0
  const ids = new Map(nodes.map(node => [node.key, randomUUID()]))
  const used = new Set()
  // Files for the moodboard: the project's own first, then the whole Library, each file only once per template.
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
  // A moodboard gets its pictures in a grid of four columns and keeps the other items where the template puts them.
  const pinned = groups => groups.flatMap(([words, count]) => pick(words, count)).map((assetId, k) => ({ kind: 'file', assetId, x: 16 + (k % 4) * 184, y: 16 + Math.floor(k / 4) * 256 }))
  const added = nodes.filter(node => known(node.type)).map(({ key, find, count, sceneKey, board, ...node }) => ({
    ...node, id: ids.get(key), x: Math.round(node.x + right), y: Math.round(node.y + top), prompt: node.prompt ?? '',
    params: { ...node.params, ...(node.type === 'library' && { assetIds: find ? pick(find, count) : [] }), ...(node.params?.from && { from: ids.get(node.params.from) }),
      ...(board && { items: [...pinned(board), ...node.params.items].map(item => ({ id: randomUUID(), ...item })) }) },
  }))
  const placed = new Set(added.map(node => node.id))
  const newEdges = edges.map(edge => ({ id: randomUUID(), source: ids.get(edge.source), sourceHandle: edge.sourceHandle, target: ids.get(edge.target), targetHandle: edge.targetHandle }))
    .filter(edge => placed.has(edge.source) && placed.has(edge.target))
  const merged = adoptIntoFrames({ ...data, nodes: [...data.nodes, ...added], edges: [...data.edges, ...newEdges] }, node => node.type === 'frame').doc
  const record = store.setAppData(projectId, 'flow', { revision, data: merged })
  return { record, added: added.length, skipped }
}
