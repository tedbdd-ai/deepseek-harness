/**
 * Flow engine: resolves the values on each port of a project's flow and runs node types from `creativeNodes`.
 *
 * The flow document (`app_data(flow)`: `{ nodes: [{ id, type, x, y, prompt, params }], edges: [{ id, source, sourceHandle,
 * target, targetHandle }] }`) is written by the editor. The run state lives apart in the setting `flows:state:<projectId>`
 * (`{ [nodeId]: { status, outputs, key, error, credits, ms, history } }`), so editor saves and finished jobs never collide.
 * Runs start only from `run()`, which callers expose behind an explicit user action.
 */
import { createHash } from 'node:crypto'
import { InputError } from '../../../store.mjs'
import { absolute, adoptIntoFrames, readingOrder } from './frames.mjs'
import { implicitEdges, mentionPattern, nodeName, textHandle } from './mentions.mjs'

export { nodeName, readingOrder }

const keepHistory = 8
const kinds = ['text', 'image', 'video', 'audio']


/**
 * Replaces `@Name` mentions with what the model understands: the reference marks of the node's files (`@Bild1`,
 * `@Image2` …), the text of a text asset (`@Look`), or both as „text (@Bild1, @Bild2)“.
 * @param {string} text prompt or incoming text.
 * @param {{ mark: string, name: string }[]} refs marks of the values on the node's inputs.
 * @param {string[]} names names that may be mentioned; mentioning one that reaches this node neither by line nor as
 *   project asset fails.
 * @param {Record<string, string>} [texts] text of the text assets that reach this node, by name.
 * @returns {string} the text with marks.
 */
export function resolveMentions(text, refs, names, texts = {}) {
  const all = [...new Set([...refs.map(ref => ref.name), ...names, ...Object.keys(texts)])].sort((a, b) => b.length - a.length)
  let result = text
  for (const name of all) {
    const pattern = mentionPattern(name)
    if (!pattern.test(result)) continue
    const same = item => item.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')
    const marks = refs.filter(ref => same(ref.name)).map(ref => ref.mark)
    const said = Object.entries(texts).find(([key]) => same(key))?.[1]
    if (!marks.length && !said) throw new InputError(`„${name}“ ist nicht mit diesem Knoten verbunden. Verbinde den Knoten, lege ihn als Projekt-Asset fest oder entferne @${name} aus dem Text.`)
    const value = said && marks.length ? `${said} (${marks.join(', ')})` : said || marks.join(', ')
    result = result.replace(mentionPattern(name), () => value)
  }
  return result
}

/** Error text for the node card; unexpected errors are logged and replaced by a general sentence. */
function failureText(error) {
  if (error instanceof InputError || error?.name === 'ProviderError' || error?.status) return error.message
  console.error('Flows:', error)
  return 'Der Knoten konnte nicht ausgeführt werden.'
}

/**
 * @param {ReturnType<typeof import('../../../store.mjs').openStore>} store
 * @param {ReturnType<typeof import('../../../core.mjs').createNodeRegistry>} registry
 */
export function createEngine(store, registry) {
  // Node ids that run in this process; a stored `running` without an entry here was cut off by a restart.
  const active = new Map()
  let stopped = false
  const stateKey = projectId => 'flows:state:' + projectId
  const readState = projectId => store.settings(stateKey(projectId))
  const patch = (projectId, nodeId, change) => {
    if (stopped) return
    const state = readState(projectId)
    state[nodeId] = { ...state[nodeId], ...change(state[nodeId] ?? {}) }
    store.setSettings(stateKey(projectId), state)
  }

  function flow(projectId) {
    const data = store.appData(projectId, 'flow').data
    const doc = { nodes: Array.isArray(data.nodes) ? data.nodes : [], edges: Array.isArray(data.edges) ? data.edges : [] }
    // Flows saved before frames were sub-flows have no `parentId`; read them the same way the editor shows them.
    const framed = adoptIntoFrames(doc, node => Boolean(registry.node(node.type)?.contains)).doc
    // Mentions of project assets count as lines for ordering, planning and staleness.
    return { ...framed, edges: [...framed.edges, ...implicitEdges(framed, typeOf)] }
  }
  function typeOf(name) {
    const type = registry.node(name)
    return type && { ...type, runs: Boolean(type.run) }
  }

  function live(projectId, state, nodeId) {
    const entry = state[nodeId]
    if (entry?.status === 'running' || entry?.status === 'waiting') {
      if (!active.get(projectId)?.has(nodeId)) return { ...entry, status: 'failed', error: 'Unterbrochen, weil der Hub neu gestartet wurde. Ein Videoauftrag läuft beim Anbieter weiter und erscheint im Video Playground.' }
    }
    return entry
  }

  /** Values of the nodes inside a frame (its sub-flow children), by port kind and in reading order. */
  function membersOf(projectId, doc, state, frame) {
    const inside = doc.nodes.filter(node => node.parentId === frame.id)
    const members = Object.fromEntries(kinds.map(kind => [kind, []]))
    for (const node of readingOrder(inside)) {
      const type = registry.node(node.type)
      const outputs = type && outputsOf(projectId, doc, state, node)
      if (!outputs) continue
      for (const port of type.outputs) members[port.kind].push(...(outputs[port.id] ?? []))
    }
    return members
  }

  /** Outputs of one node: computed for source nodes, the last result for run nodes. */
  function outputsOf(projectId, doc, state, node) {
    const type = registry.node(node.type)
    if (!type) return null
    if (type.resolve) return type.resolve({ params: node.params ?? {}, prompt: node.prompt ?? '', projectId,
      ...(type.contains && { members: membersOf(projectId, doc, state, node) }) })
    const entry = live(projectId, state, node.id)
    return entry?.outputs ?? null
  }

  /**
   * Values arriving at each input of `node`. Several edges on one input are ordered by the source nodes' reading order.
   * Inputs with a `mark` number their values per mark (`@Bild1`, `@Bild2` …) in input order; `refs` lists them.
   * Text assets mentioned in the prompt arrive in `texts` by name; when there are any, `inputs._texts` carries them too,
   * so a changed asset text marks the result stale.
   * @returns {{ inputs: Record<string, string[]>, missing: string[], refs: { mark: string, nodeId: string, name: string, value: string }[], texts: Record<string, string> }}
   *   `missing` lists upstream nodes without a result.
   */
  function inputsOf(projectId, doc, state, node) {
    const byId = new Map(doc.nodes.map(item => [item.id, item]))
    const inputs = {}
    const missing = []
    const refs = []
    const counters = {}
    for (const port of registry.node(node.type)?.inputs ?? []) {
      const edges = doc.edges.filter(edge => edge.target === node.id && edge.targetHandle === port.id && byId.has(edge.source))
      const order = readingOrder(edges.map(edge => ({ id: edge.source, ...absolute(byId.get(edge.source), byId) }))).map(source => source.id)
      edges.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))
      const values = []
      for (const edge of edges) {
        const source = byId.get(edge.source)
        const outputs = outputsOf(projectId, doc, state, source)
        if (!outputs) { missing.push(edge.source); continue }
        for (const value of outputs[edge.sourceHandle] ?? []) values.push({ value, source })
      }
      const kept = port.multiple ? values : values.slice(-1)
      inputs[port.id] = kept.map(item => item.value)
      if (port.mark) {
        for (const item of kept) {
          counters[port.mark] = (counters[port.mark] ?? 0) + 1
          refs.push({ mark: '@' + port.mark + counters[port.mark], nodeId: item.source.id, name: nodeName(item.source, registry.node(item.source.type)), value: item.value })
        }
      }
    }
    const texts = {}
    for (const edge of doc.edges.filter(item => item.target === node.id && item.targetHandle === textHandle && byId.has(item.source))) {
      const source = byId.get(edge.source)
      const outputs = outputsOf(projectId, doc, state, source)
      if (!outputs) { missing.push(edge.source); continue }
      const said = (outputs[edge.sourceHandle] ?? []).join('\n').trim()
      if (said) texts[nodeName(source, registry.node(source.type))] = said
    }
    if (Object.keys(texts).length) inputs._texts = Object.entries(texts).map(([name, said]) => name + ': ' + said)
    return { inputs, missing, refs, texts }
  }

  /** Names of all nodes that carry media and of all project assets, for checking `@` mentions. */
  function mediaNames(doc) {
    return doc.nodes.filter(node => node.asset || registry.node(node.type)?.outputs.some(port => port.kind !== 'text'))
      .map(node => nodeName(node, registry.node(node.type)))
  }

  const keyOf = (node, inputs) => createHash('sha256').update(JSON.stringify([node.type, node.prompt ?? '', node.params ?? {}, inputs])).digest('hex').slice(0, 24)

  /** Upstream and downstream node ids, for planning and cycle checks. */
  function neighbours(doc) {
    const up = new Map(doc.nodes.map(node => [node.id, []]))
    const down = new Map(doc.nodes.map(node => [node.id, []]))
    for (const edge of doc.edges) {
      if (!up.has(edge.target) || !down.has(edge.source)) continue
      up.get(edge.target).push(edge.source)
      down.get(edge.source).push(edge.target)
    }
    return { up, down }
  }

  /** Orders `ids` so that every node comes after its upstream nodes; throws on a cycle. */
  function ordered(doc, ids) {
    const { up } = neighbours(doc)
    const result = []
    const seen = new Map()
    const visit = id => {
      if (seen.get(id) === 'done') return
      if (seen.get(id) === 'open') throw new InputError('Der Flow enthält einen Kreis. Entferne eine der Verbindungen im Kreis.')
      seen.set(id, 'open')
      for (const source of up.get(id) ?? []) visit(source)
      seen.set(id, 'done')
      if (ids.has(id)) result.push(id)
    }
    for (const id of ids) visit(id)
    return result
  }

  /**
   * Lists the run nodes that `run(projectId, nodeId, scope)` would start, in an order that respects their lines.
   * `nodeId` may be a list (the film strip renders several shots at once); the plans are joined.
   * - `node`: only this node.
   * - `upstream`: run nodes before it that have no current result, then this node.
   * - `downstream`: this node and every run node after it; for a source node (Notiz, Datei …) the run nodes it feeds.
   * @returns {{ id: string, type: string, title: string, name: string, paid: boolean }[]}
   */
  function plan(projectId, nodeId, scope) {
    if (Array.isArray(nodeId)) {
      if (!nodeId.length) throw new InputError('Wähle mindestens einen Knoten.')
      const doc = flow(projectId)
      const ids = new Set(nodeId.flatMap(id => planOne(projectId, id, scope)).map(step => step.id))
      return ordered(doc, ids).map(id => step(doc, id))
    }
    return planOne(projectId, nodeId, scope)
  }
  function step(doc, id) {
    const item = doc.nodes.find(n => n.id === id)
    const type = registry.node(item.type)
    return { id: item.id, type: item.type, title: type.title, name: nodeName(item, type), paid: Boolean(type.paid) }
  }
  function planOne(projectId, nodeId, scope) {
    const doc = flow(projectId)
    const state = readState(projectId)
    const node = doc.nodes.find(item => item.id === nodeId)
    if (!node) throw new InputError('Den Knoten gibt es im gespeicherten Flow nicht. Warte, bis „Gespeichert“ erscheint.', 404)
    // A source node has nothing to run itself; „Ab hier ausführen“ runs the nodes it feeds.
    const source = !registry.node(node.type)?.run
    if (source && scope !== 'downstream') throw new InputError('Dieser Knoten liefert seine Werte ohne Ausführen.')
    const { up, down } = neighbours(doc)
    const ids = new Set([nodeId])
    if (scope === 'downstream') {
      const walk = id => { for (const next of down.get(id) ?? []) if (!ids.has(next)) { ids.add(next); walk(next) } }
      walk(nodeId)
    } else if (scope === 'upstream') {
      const walk = id => {
        for (const prev of up.get(id) ?? []) {
          if (ids.has(prev)) continue
          const item = doc.nodes.find(n => n.id === prev)
          const type = registry.node(item.type)
          if (type?.run) {
            const entry = live(projectId, state, prev)
            const current = entry?.status === 'done' && entry.key === keyOf(item, inputsOf(projectId, doc, state, item).inputs)
            if (!current) ids.add(prev)
          }
          walk(prev)
        }
      }
      walk(nodeId)
    } else if (scope !== 'node') throw new InputError('Unbekannter Umfang für das Ausführen.')
    const steps = ordered(doc, ids).filter(id => registry.node(doc.nodes.find(n => n.id === id).type)?.run).map(id => step(doc, id))
    if (source && !steps.length) throw new InputError('Mit diesem Knoten ist noch kein Knoten verbunden, der ausgeführt wird.')
    return steps
  }

  async function execute(projectId, nodeId, waitFor) {
    try { return await attempt(projectId, nodeId, waitFor) } finally { active.get(projectId)?.delete(nodeId) }
  }

  async function attempt(projectId, nodeId, waitFor) {
    const results = await Promise.all(waitFor)
    if (stopped) return false
    if (results.some(ok => !ok)) {
      patch(projectId, nodeId, () => ({ status: 'failed', error: 'Ein Schritt davor ist fehlgeschlagen. Er wurde nicht ausgeführt.' }))
      return false
    }
    const doc = flow(projectId)
    const node = doc.nodes.find(item => item.id === nodeId)
    const type = node && registry.node(node.type)
    if (!type) {
      patch(projectId, nodeId, () => ({ status: 'failed', error: 'Den Knoten oder seine Knotenart gibt es nicht mehr.' }))
      return false
    }
    const started = Date.now()
    try {
      const state = readState(projectId)
      const { inputs, missing, refs, texts } = inputsOf(projectId, doc, state, node)
      if (missing.length) {
        const names = missing.map(id => registry.node(doc.nodes.find(n => n.id === id)?.type)?.title ?? 'Knoten')
        throw new InputError(`Führe zuerst ${[...new Set(names)].map(name => '„' + name + '“').join(', ')} aus.`)
      }
      for (const port of type.inputs) if (port.required && !inputs[port.id].length) throw new InputError(`Verbinde den Eingang „${port.label}“.`)
      const key = keyOf(node, inputs)
      // File mentions are resolved only on nodes that number references; text assets are put in everywhere.
      let prompt = node.prompt ?? ''
      const marked = type.inputs.some(port => port.mark)
      if (marked || Object.keys(texts).length) {
        const names = marked ? mediaNames(doc) : []
        prompt = resolveMentions(prompt, refs, names, texts)
        for (const port of type.inputs) if (port.kind === 'text') inputs[port.id] = inputs[port.id].map(text => resolveMentions(text, refs, names, texts))
      }
      delete inputs._texts
      const assets = doc.nodes.filter(item => item.asset && item.id !== node.id).map(item => nodeName(item, registry.node(item.type)))
      patch(projectId, nodeId, () => ({ status: 'running', startedAt: new Date(started).toISOString(), error: undefined }))
      const result = await type.run({ inputs, params: node.params ?? {}, prompt, projectId, assets, stopped: () => stopped })
      patch(projectId, nodeId, entry => {
        const done = { outputs: result.outputs, ...(result.data !== undefined && { data: result.data }), credits: result.credits ?? null, at: new Date().toISOString(), key }
        return { status: 'done', ...done, ms: Date.now() - started, error: undefined, history: [done, ...(entry.history ?? [])].slice(0, keepHistory) }
      })
      return true
    } catch (error) {
      patch(projectId, nodeId, () => ({ status: 'failed', error: failureText(error), ms: Date.now() - started }))
      return false
    }
  }

  return {
    /** Ends the plugin's lifetime: running node types see `stopped()` and results are no longer written. */
    stop() { stopped = true },
    plan,
    /**
     * Starts the planned nodes and returns at once; poll `view()` for progress.
     * @returns {{ id: string, title: string, paid: boolean }[]} the started nodes.
     */
    run(projectId, nodeId, scope = 'node') {
      if (stopped) throw new InputError('Das Atelier wird neu gestartet.', 503)
      const steps = plan(projectId, nodeId, scope)
      const running = active.get(projectId) ?? new Set()
      active.set(projectId, running)
      const busy = steps.find(step => running.has(step.id))
      if (busy) throw new InputError(`„${busy.name}“ läuft noch. Warte, bis der Knoten fertig ist.`, 409)
      const doc = flow(projectId)
      const { up } = neighbours(doc)
      const promises = new Map()
      for (const step of steps) {
        running.add(step.id)
        patch(projectId, step.id, () => ({ status: 'waiting', error: undefined }))
      }
      for (const step of steps) {
        const waitFor = []
        const collect = id => { for (const prev of up.get(id) ?? []) { if (promises.has(prev)) waitFor.push(promises.get(prev)); else collect(prev) } }
        collect(step.id)
        promises.set(step.id, execute(projectId, step.id, waitFor))
      }
      return steps
    },
    /**
     * Current state of every node: status, outputs (source nodes included), whether the result is stale and errors.
     * @returns {Record<string, { status: string, outputs: Record<string, string[]> | null, stale: boolean, error?: string, credits?: number | null, ms?: number, history?: object[] }>}
     */
    view(projectId) {
      const doc = flow(projectId)
      const state = readState(projectId)
      const nodes = {}
      for (const node of doc.nodes) {
        const type = registry.node(node.type)
        if (!type) { nodes[node.id] = { status: 'unknown', outputs: null, stale: false, error: 'Diese Knotenart ist gerade nicht geladen.' }; continue }
        try {
          if (type.resolve) { nodes[node.id] = { status: 'source', outputs: outputsOf(projectId, doc, state, node), stale: false }; continue }
          const entry = live(projectId, state, node.id) ?? { status: 'idle' }
          const { inputs, refs } = inputsOf(projectId, doc, state, node)
          const stale = entry.status === 'done' && entry.key !== keyOf(node, inputs)
          const warnings = type.check ? type.check({ inputs, params: node.params ?? {} }) : []
          nodes[node.id] = { status: entry.status, outputs: entry.outputs ?? null, data: entry.data, stale, refs, warnings, error: entry.error, credits: entry.credits, ms: entry.ms, startedAt: entry.startedAt, history: entry.history ?? [] }
        } catch (error) {
          nodes[node.id] = { status: 'failed', outputs: null, stale: false, error: failureText(error) }
        }
      }
      return nodes
    },
    /** Makes an earlier result of a run node its current output again. */
    pick(projectId, nodeId, index) {
      const entry = readState(projectId)[nodeId]
      const chosen = entry?.history?.[index]
      if (!chosen) throw new InputError('Dieses Ergebnis ist nicht mehr im Verlauf.', 404)
      if (active.get(projectId)?.has(nodeId)) throw new InputError('Der Knoten läuft gerade.', 409)
      patch(projectId, nodeId, () => ({ outputs: chosen.outputs, data: chosen.data, credits: chosen.credits, at: chosen.at, key: chosen.key }))
      return this.view(projectId)
    },
  }
}
