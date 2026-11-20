/**
 * Flows editor: the canvas of one project. Node types come from `/creativity-flows/api/nodes`, the flow is saved to
 * `app_data(flow)` through the hub API, and runs start only from the Ausführen button of a node.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, NodeToolbar, Position, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const flowsApi = async (path, method = 'GET', body) => {
  const response = await fetch('/creativity-flows/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.error || `Flows antwortet mit ${response.status}.`)
  return data
}
const mediaUrl = id => '/creativity-hub/api/media/' + encodeURIComponent(id)
const route = project => '#/flows?project=' + encodeURIComponent(project)

const paths = {
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  image: 'M3 5h18v14H3zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  audio: 'M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  library: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  board: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  shot: 'M3 4h18v16H3zM9 4v16M15 4v16',
  composition: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
  play: 'M7 4l13 8-13 8z',
  down: 'm6 9 6 6 6-6',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  plus: 'M5 12h14M12 5v14',
  x: 'M18 6 6 18M6 6l12 12',
  trash: 'M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
  download: 'M12 3v12m-5-5 5 5 5-5M5 21h14',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  pointer: 'M4 4l7 17 2-7 7-2z',
  hand: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-2a2 2 0 0 0-4 0',
  history: 'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9',
  upload: 'M12 21V9m-5 5 5-5 5 5M5 3h14',
}
const Icon = ({ name, size = 16 }) => <svg className="ic" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.plus}/></svg>

const kindNames = { text: 'Text', image: 'Bild', video: 'Video', audio: 'Ton' }
const groups = [['source', 'Quellen'], ['text', 'Text'], ['image', 'Bild'], ['video', 'Video'], ['audio', 'Ton']]
const statusNames = { waiting: 'Wartet', running: 'Läuft', done: 'Fertig', failed: 'Fehler' }
const Actions = createContext(null)

const optionValue = option => typeof option === 'object' ? option.value : option
const optionLabel = option => typeof option === 'object' ? option.label : option
const fieldDefault = field => field.default ?? (field.type === 'boolean' ? false : field.options ? optionValue(field.options[0]) : '')
const modelOf = (node, type) => node.params?.modelId ?? fieldDefault(type.fields.find(field => field.key === 'modelId') ?? {})
function fieldValue(node, field) {
  const value = field.model ? node.params?.settings?.[field.model]?.[field.key] : node.params?.[field.key]
  return value ?? fieldDefault(field)
}
function withField(node, field, value) {
  const params = { ...node.params }
  if (field.model) params.settings = { ...params.settings, [field.model]: { ...params.settings?.[field.model], [field.key]: value } }
  else params[field.key] = value
  return { ...node, params }
}

function Media({ asset, ctx, full = false }) {
  const host = useRef(null)
  useEffect(() => { if (asset) host.current.replaceChildren(full ? ctx.withFullscreen(asset, ctx.media(asset, { full: true })) : ctx.media(asset)) }, [asset, ctx, full])
  return <div ref={host} className="flow-media"/>
}

function Seconds({ since }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return since ? <span>{Math.max(0, Math.round((now - Date.parse(since)) / 1000))} s</span> : null
}

function Preview({ node, type, view }) {
  const { ctx, assets } = useContext(Actions)
  const [page, setPage] = useState(0)
  const media = type.outputs.filter(port => port.kind !== 'text').flatMap(port => view?.outputs?.[port.id] ?? []).filter(id => assets[id])
  const busy = view?.status === 'running' || view?.status === 'waiting'
  useEffect(() => setPage(0), [media.join()])
  if (!media.length) {
    return <div className={'flow-empty' + (busy ? ' busy' : '')}>
      <Icon name={type.outputs[0]?.kind ?? 'image'} size={20}/>
      <span>{busy ? <>{statusNames[view.status]} <Seconds since={view.startedAt}/></> : type.runs ? 'Hier erscheint dein Ergebnis.' : 'Noch nichts ausgewählt.'}</span>
    </div>
  }
  const shown = media[Math.min(page, media.length - 1)]
  return <div className="flow-preview">
    <Media asset={assets[shown]} ctx={ctx} full/>
    {busy && <span className="flow-badge">{statusNames[view.status]} <Seconds since={view.startedAt}/></span>}
    {media.length > 1 && <div className="flow-pager nodrag">
      <button className="icon" aria-label="Vorheriges Ergebnis" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="left"/></button>
      <span>{page + 1} / {media.length}</span>
      <button className="icon" aria-label="Nächstes Ergebnis" disabled={page >= media.length - 1} onClick={() => setPage(page + 1)}><Icon name="right"/></button>
    </div>}
  </div>
}

function RunButton({ node, view }) {
  const { run } = useContext(Actions)
  const [open, setOpen] = useState(false)
  const busy = view?.status === 'running' || view?.status === 'waiting'
  const label = view?.status === 'failed' ? 'Erneut ausführen' : view?.status === 'done' ? 'Neu ausführen' : 'Ausführen'
  return <div className="flow-run nodrag">
    <button className="btn sm primary" disabled={busy} onClick={() => run(node.id, 'node')}><Icon name="play"/>{busy ? statusNames[view.status] : label}</button>
    <button className="btn sm primary flow-run-more" aria-label="Weitere Arten auszuführen" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}><Icon name="down"/></button>
    {open && <div className="flow-menu" role="menu" onMouseLeave={() => setOpen(false)}>
      <button role="menuitem" onClick={() => { setOpen(false); run(node.id, 'upstream') }}>Mit fehlenden Schritten davor</button>
      <button role="menuitem" onClick={() => { setOpen(false); run(node.id, 'downstream') }}>Ab hier alles danach</button>
    </div>}
  </div>
}

function Ports({ ports, side, connected }) {
  const step = 40
  return ports.map((port, i) => <Handle key={port.id} id={port.id} type={side === 'in' ? 'target' : 'source'}
    position={side === 'in' ? Position.Left : Position.Right} className={'flow-port kind-' + port.kind + (connected.has(port.id) ? ' on' : '')}
    style={{ top: 56 + i * step }} title={port.label + ' (' + kindNames[port.kind] + (port.multiple ? ', mehrere' : '') + ')'} aria-label={port.label}>
    <Icon name={port.kind} size={12}/>
  </Handle>)
}

function NodeBody({ node, type, view }) {
  const { ctx, update, shots, pickAssets, uploadAssets, assets } = useContext(Actions)
  if (node.type === 'library') {
    const ids = node.params?.assetIds ?? []
    return <div className="flow-body">
      {ids.length > 0 && <div className="flow-thumbs">{ids.slice(0, 8).map(id => assets[id] && <Media key={id} asset={assets[id]} ctx={ctx}/>)}</div>}
      <div className="flow-row nodrag">
        <button className="btn sm" onClick={() => pickAssets(node)}>{ids.length ? `${ids.length} gewählt · Ändern` : 'Aus der Library wählen'}</button>
        <button className="btn sm" onClick={() => uploadAssets(node)}><Icon name="upload"/>Hochladen</button>
      </div>
    </div>
  }
  if (node.type === 'shot') {
    return <div className="flow-body nodrag">
      <select className="text-in" aria-label="Einstellung" value={node.params?.shotId ?? ''} onChange={e => update(node.id, n => ({ ...n, params: { ...n.params, shotId: e.target.value } }))}>
        <option value="">Einstellung wählen</option>
        {shots.map((shot, i) => <option key={shot.id} value={shot.id}>{(i + 1) + '. ' + (shot.title || shot.prompt.slice(0, 40) || 'Ohne Titel')}</option>)}
      </select>
      {!shots.length && <p className="meta">Im Storyboard dieses Projekts gibt es noch keine Einstellung.</p>}
      {view?.outputs?.text?.[0] && <p className="flow-quote">{view.outputs.text[0]}</p>}
    </div>
  }
  return null
}

function FlowNode({ id, data, selected }) {
  const { update, remove, duplicate, pick, edges } = useContext(Actions)
  const { node, type, view } = data
  const [history, setHistory] = useState(false)
  const [panel, setPanel] = useState(false)
  if (!type) {
    return <article className="flow-node unknown"><header className="flow-head"><span>Unbekannter Knoten</span></header>
      <div className="flow-card"><p className="flow-error">Die Knotenart „{node.type}“ ist gerade nicht geladen. Prüfe, ob ihr Plugin läuft.</p>
        <div className="flow-row nodrag"><button className="btn sm danger" onClick={() => remove(id)}>Entfernen</button></div></div></article>
  }
  const model = modelOf(node, type)
  const modelField = type.fields.find(field => field.key === 'modelId')
  const modelName = modelField && optionLabel(modelField.options.find(option => optionValue(option) === model) ?? '')
  const inbound = new Set(edges.filter(edge => edge.target === id).map(edge => edge.targetHandle))
  const outbound = new Set(edges.filter(edge => edge.source === id).map(edge => edge.sourceHandle))
  // A Library node shows only the outputs that carry files or lines; with nothing chosen it shows all three.
  const used = node.type === 'library' ? type.outputs.filter(port => view?.outputs?.[port.id]?.length || outbound.has(port.id)) : []
  const outputs = used.length ? used : type.outputs
  const settings = type.fields.filter(field => field.key !== 'modelId' && (field.type === 'enum' || field.type === 'boolean') && (!field.model || field.model === model))
  const firstMedia = type.outputs.filter(port => port.kind !== 'text').flatMap(port => view?.outputs?.[port.id] ?? [])[0]
  const tall = Math.max(type.inputs.length, outputs.length)
  const state = view?.stale ? 'Veraltet' : statusNames[view?.status] ?? ''
  return <article className={'flow-node' + (type.runs ? ' runs' : '') + (selected ? ' active' : '') + (view?.status ? ' is-' + view.status : '')} style={{ minHeight: 56 + tall * 40 }}>
    <header className="flow-head"><Icon name={type.icon}/><span>{type.title}</span>{modelName && <small>{modelName}</small>}</header>
    <Ports ports={type.inputs} side="in" connected={inbound}/>
    <div className="flow-card">
      {type.outputs.some(port => port.kind !== 'text') && node.type !== 'library' && <Preview node={node} type={type} view={view}/>}
      <NodeBody node={node} type={type} view={view}/>
      {type.prompt && <textarea className="flow-prompt nodrag nowheel" rows={node.type === 'text' ? 6 : 3} aria-label={type.title + ': Prompt'}
        placeholder={node.type === 'text' ? 'Text, den verbundene Knoten als Prompt bekommen …' : type.inputs.some(port => port.id === 'prompt') ? 'Beschreibe, was entstehen soll. Verbundener Text kommt davor.' : 'Beschreibe, was entstehen soll …'}
        value={node.prompt ?? ''} onChange={e => update(id, n => ({ ...n, prompt: e.target.value }))}/>}
      {view?.status === 'failed' && view.error && <p className="flow-error" role="alert">{view.error}</p>}
      {view?.status === 'unknown' && <p className="flow-error">{view.error}</p>}
      {type.runs && <footer className="flow-foot">
        <span className={'flow-state' + (view?.stale ? ' stale' : '')}>{state}{view?.status === 'done' && typeof view.credits === 'number' ? ` · ${view.credits} Credits` : ''}</span>
        <RunButton node={node} view={view}/>
      </footer>}
    </div>
    <Ports ports={outputs} side="out" connected={outbound}/>
    <NodeToolbar isVisible={selected} position={Position.Bottom} className="flow-toolbar nodrag">
      {modelField && <label className="flow-field"><span className="sr-only">{modelField.label}</span>
        <select className="text-in" title={modelField.label} value={String(model)} onChange={e => update(id, n => withField(n, modelField, e.target.value))}>
          {modelField.options.map(option => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}</select></label>}
      {settings.length > 0 && <div className="flow-history">
        <button className="btn sm" aria-expanded={panel} onClick={() => setPanel(!panel)}>Einstellungen</button>
        {panel && <div className="flow-menu flow-settings">{settings.map(field => <label key={(field.model ?? '') + field.key} className="flow-setting">
          <span>{field.label}</span>
          {field.type === 'enum'
            ? <select className="text-in" value={String(fieldValue(node, field))} onChange={e => update(id, n => withField(n, field, e.target.value))}>
              {field.options.map(option => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}</select>
            : <input type="checkbox" checked={Boolean(fieldValue(node, field))} onChange={e => update(id, n => withField(n, field, e.target.checked))}/>}
        </label>)}</div>}
      </div>}
      {(view?.history?.length ?? 0) > 1 && <div className="flow-history">
        <button className="btn sm" aria-expanded={history} onClick={() => setHistory(!history)}><Icon name="history"/>Verlauf</button>
        {history && <div className="flow-menu" role="menu">{view.history.map((entry, i) => <button key={entry.at + i} role="menuitem" onClick={() => { setHistory(false); pick(id, i) }}>
          {new Date(entry.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{i === 0 ? ' · neuestes' : ''}</button>)}</div>}
      </div>}
      {firstMedia && <a className="btn sm icon-btn" href={mediaUrl(firstMedia)} download aria-label="Ergebnis laden" title="Ergebnis laden"><Icon name="download"/></a>}
      <button className="btn sm icon-btn" aria-label="Knoten duplizieren" title="Duplizieren" onClick={() => duplicate(id)}><Icon name="copy"/></button>
      <button className="btn sm icon-btn danger" aria-label="Knoten löschen" title="Löschen" onClick={() => remove(id)}><Icon name="trash"/></button>
    </NodeToolbar>
  </article>
}
const nodeTypes = { flow: FlowNode }

function AddMenu({ types, at, filter, onPick, onClose }) {
  const list = types.filter(type => !filter || (filter.side === 'source' ? type.inputs : type.outputs).some(port => port.kind === filter.kind))
  const first = useRef(null)
  useEffect(() => { first.current?.focus() }, [])
  return <div className="flow-add" role="dialog" aria-label="Knoten hinzufügen" style={at.screen ? { left: at.screen.x, top: at.screen.y } : undefined}
    onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
    <header><strong>{filter ? `Knoten für ${kindNames[filter.kind]}` : 'Knoten hinzufügen'}</strong>
      <button className="icon" aria-label="Schließen" onClick={onClose}><Icon name="x"/></button></header>
    {!list.length && <p className="meta">Keine Knotenart passt zu diesem Port.</p>}
    {groups.map(([group, title]) => {
      const items = list.filter(type => type.group === group)
      return items.length > 0 && <section key={group}><small>{title}</small>
        {items.map((type, i) => <button key={type.type} ref={group === groups.find(([g]) => list.some(t => t.group === g))?.[0] && i === 0 ? first : null} onClick={() => onPick(type)}>
          <Icon name={type.icon}/><span><b>{type.title}{type.paid ? ' · kostet Credits' : ''}</b><em>{type.description}</em></span></button>)}</section>
    })}
  </div>
}

function AssetPicker({ ctx, initial, onDone, onClose }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState(initial)
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => ctx.api('/search?' + new URLSearchParams({ q: query, limit: 60 }))
      .then(result => { if (active) { setItems(result.items.filter(item => /^(image|video|audio)\//.test(item.media_type ?? '') || item.preview)); setError('') } })
      .catch(e => { if (active) setError(e.message) }), 250)
    return () => { active = false; clearTimeout(timer) }
  }, [query])
  const toggle = id => setChosen(chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id].slice(0, 24))
  return <div className="flow-modal" role="dialog" aria-modal="true" aria-label="Dateien wählen" onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
    <div className="flow-sheet">
      <header><strong>Dateien wählen</strong><button className="icon" aria-label="Schließen" onClick={onClose}><Icon name="x"/></button></header>
      <input className="text-in" autoFocus placeholder="In Sammlung und Library suchen" value={query} onChange={e => setQuery(e.target.value)}/>
      {error ? <p className="canvas-note err" role="alert">{error} <button className="btn sm" onClick={() => setQuery(query + ' ')}>Erneut versuchen</button></p>
        : !items ? <div className="flow-grid" aria-label="Lädt">{Array.from({ length: 8 }, (_, i) => <span key={i} className="flow-skel"/>)}</div>
          : !items.length ? <p className="meta">{query.trim() ? 'Nichts gefunden. Versuch ein anderes Wort.' : 'Die Library ist noch leer. Lade Dateien über „Hochladen“ hoch.'}</p>
            : <div className="flow-grid">{items.map(item => <button key={item.id} className={'flow-pick' + (chosen.includes(item.id) ? ' on' : '')} aria-pressed={chosen.includes(item.id)} onClick={() => toggle(item.id)}>
              <Media asset={item} ctx={ctx}/><span>{item.title}</span></button>)}</div>}
      <footer><span className="meta">{chosen.length} gewählt</span><button className="btn sm" onClick={onClose}>Abbrechen</button><button className="btn primary sm" onClick={() => onDone(chosen)}>Übernehmen</button></footer>
    </div>
  </div>
}

function Confirm({ steps, onYes, onNo }) {
  const paid = steps.filter(step => step.paid)
  return <div className="flow-modal" role="alertdialog" aria-modal="true" aria-label="Ausführen bestätigen" onKeyDown={e => { if (e.key === 'Escape') onNo() }}>
    <div className="flow-sheet narrow">
      <header><strong>{steps.length} Knoten ausführen?</strong></header>
      <p>{paid.length} davon rufen einen Anbieter auf und kosten Credits:</p>
      <ol>{steps.map(step => <li key={step.id}>{step.title}{step.paid ? ' · kostet Credits' : ''}</li>)}</ol>
      <footer><button className="btn sm" autoFocus onClick={onNo}>Abbrechen</button><button className="btn primary sm" onClick={onYes}>Alle ausführen</button></footer>
    </div>
  </div>
}

function Canvas({ ctx, project, record, types, shots }) {
  const flow = useReactFlow()
  const [doc, setDoc] = useState(() => ({ nodes: [], edges: [], ...record.data }))
  const [view, setView] = useState({ nodes: {}, assets: {} })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(null)
  const [picker, setPicker] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [hand, setHand] = useState(false)
  const [selected, setSelected] = useState(new Set())
  // Measured sizes must go back into the controlled nodes, or React Flow hides them after the next render.
  const [sizes, setSizes] = useState({})
  const state = useRef({ data: doc, saved: doc, revision: record.revision, timer: null, saving: null }).current
  const typeOf = useMemo(() => new Map(types.map(type => [type.type, type])), [types])

  async function refresh() {
    try { setView(await flowsApi('/projects/' + project + '/state')) } catch (e) { setError(e.message) }
  }
  async function flush() {
    clearTimeout(state.timer)
    if (state.saving) return state.saving
    state.saving = (async () => {
      while (state.saved !== state.data) {
        const data = state.data
        const result = await ctx.api('/projects/' + project + '/apps/flow', 'PUT', { data, revision: state.revision })
        state.revision = result.revision
        state.saved = data
      }
      setStatus('Gespeichert')
    })()
    try { await state.saving; await refresh() } finally { state.saving = null }
  }
  function change(update) {
    state.data = { ...state.data, ...update(state.data) }
    setDoc(state.data)
    setStatus('Speichert …')
    clearTimeout(state.timer)
    state.timer = setTimeout(() => flush().catch(report), 400)
  }
  function report(e) { setError(e.message); setStatus('Speichern prüfen') }
  useEffect(() => { refresh() }, [])
  useEffect(() => () => { if (state.saved !== state.data) flush().catch(e => ctx.toast(e.message, true)) }, [])
  const busy = Object.values(view.nodes).some(item => item.status === 'running' || item.status === 'waiting')
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [busy])

  const update = (id, fn) => change(d => ({ nodes: d.nodes.map(node => node.id === id ? fn(node) : node) }))
  const remove = id => change(d => ({ nodes: d.nodes.filter(node => node.id !== id), edges: d.edges.filter(edge => edge.source !== id && edge.target !== id) }))
  const duplicate = id => {
    const node = state.data.nodes.find(item => item.id === id)
    if (node) change(d => ({ nodes: [...d.nodes, { ...structuredClone(node), id: crypto.randomUUID(), x: node.x + 48, y: node.y + 48 }] }))
  }
  function addNode(type, position, link) {
    const node = { id: crypto.randomUUID(), type: type.type, x: Math.round(position.x), y: Math.round(position.y), prompt: '', params: {} }
    let edge = null
    if (link) {
      const ports = link.side === 'source' ? type.inputs : type.outputs
      const port = ports.find(item => item.kind === link.kind)
      if (port) edge = link.side === 'source'
        ? { id: crypto.randomUUID(), source: link.nodeId, sourceHandle: link.handle, target: node.id, targetHandle: port.id }
        : { id: crypto.randomUUID(), source: node.id, sourceHandle: port.id, target: link.nodeId, targetHandle: link.handle }
    }
    change(d => ({ nodes: [...d.nodes, node], edges: edge ? connectEdges(d, edge) : d.edges }))
    setMenu(null)
  }
  function connectEdges(d, edge) {
    const port = typeOf.get(d.nodes.find(node => node.id === edge.target)?.type)?.inputs.find(item => item.id === edge.targetHandle)
    const kept = d.edges.filter(item => !(item.target === edge.target && item.targetHandle === edge.targetHandle && (!port?.multiple || item.source === edge.source && item.sourceHandle === edge.sourceHandle)))
    return [...kept, edge]
  }
  function portKind(nodeId, handle, side) {
    const node = state.data.nodes.find(item => item.id === nodeId)
    return typeOf.get(node?.type)?.[side === 'source' ? 'outputs' : 'inputs'].find(port => port.id === handle)?.kind
  }
  function reaches(from, to) {
    const seen = new Set()
    const walk = id => id === to || (!seen.has(id) && (seen.add(id), state.data.edges.filter(edge => edge.source === id).some(edge => walk(edge.target))))
    return walk(from)
  }
  const valid = connection => connection.source !== connection.target &&
    portKind(connection.source, connection.sourceHandle, 'source') === portKind(connection.target, connection.targetHandle, 'target') &&
    !reaches(connection.target, connection.source)

  async function run(nodeId, scope) {
    try {
      await flush()
      const { steps } = await flowsApi('/projects/' + project + '/run', 'POST', { nodeId, scope, dryRun: true })
      const start = async () => { setConfirm(null); await flowsApi('/projects/' + project + '/run', 'POST', { nodeId, scope }); await refresh() }
      if (!steps.length) return ctx.toast('Alle Schritte davor sind aktuell.')
      if (steps.filter(step => step.paid).length > 1) setConfirm({ steps, start })
      else await start()
    } catch (e) { setError(e.message) }
  }
  async function pick(nodeId, index) {
    try { setView(await flowsApi('/projects/' + project + '/nodes/' + nodeId + '/pick', 'POST', { index })) } catch (e) { setError(e.message) }
  }
  function pickAssets(node) { setPicker(node.id) }
  function uploadAssets(node) {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'image/*,video/*' })
    input.onchange = async () => {
      const created = await ctx.uploadFiles(input.files, { projectId: project })
      if (created.length) update(node.id, n => ({ ...n, params: { ...n.params, assetIds: [...(n.params?.assetIds ?? []), ...created.map(item => item.id)].slice(0, 24) } }))
    }
    input.click()
  }
  function template() {
    const text = { id: crypto.randomUUID(), type: 'text', x: 0, y: 160, prompt: '', params: {} }
    const image = { id: crypto.randomUUID(), type: 'image', x: 400, y: 80, prompt: '', params: {} }
    const video = { id: crypto.randomUUID(), type: 'video', x: 880, y: 80, prompt: '', params: {} }
    change(() => ({ nodes: [text, image, video].filter(node => typeOf.has(node.type)), edges: [
      { id: crypto.randomUUID(), source: text.id, sourceHandle: 'text', target: image.id, targetHandle: 'prompt' },
      { id: crypto.randomUUID(), source: image.id, sourceHandle: 'image', target: video.id, targetHandle: 'start' },
    ].filter(edge => typeOf.has('image') && typeOf.has('video')) }))
    setTimeout(() => flow.fitView({ padding: 0.2, duration: 0 }), 50)
  }
  const shell = useRef(null)
  /** Opens the node menu at a screen point; new nodes go to the matching point on the canvas. */
  function openMenu(point, filter) {
    const box = shell.current.getBoundingClientRect()
    setMenu({ position: flow.screenToFlowPosition(point), filter,
      screen: { x: Math.max(16, Math.min(point.x - box.left, box.width - 352)), y: Math.max(64, Math.min(point.y - box.top, box.height - 456)) } })
  }
  const pointOf = event => 'changedTouches' in event ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY } : { x: event.clientX, y: event.clientY }
  function openCentered() {
    const box = shell.current.getBoundingClientRect()
    openMenu({ x: box.left + box.width / 2 - 168, y: box.top + box.height / 2 - 200 }, null)
  }

  const edges = doc.edges.map(edge => ({ ...edge, className: 'flow-edge kind-' + (portKind(edge.source, edge.sourceHandle, 'source') ?? 'text') }))
  const nodes = doc.nodes.map(node => ({ id: node.id, type: 'flow', position: { x: node.x, y: node.y }, selected: selected.has(node.id), dragHandle: '.flow-head', measured: sizes[node.id],
    data: { node, type: typeOf.get(node.type), view: view.nodes[node.id] } }))
  const actions = { ctx, assets: view.assets, edges: doc.edges, update, remove, duplicate, run, pick, shots, pickAssets, uploadAssets }

  return <Actions.Provider value={actions}>
    <div className="flow-shell" ref={shell}>
      <div className="flow-top">
        <select className="text-in" aria-label="Projekt" value={project} onChange={async e => { try { await flush(); location.hash = route(e.target.value) } catch (err) { report(err) } }}>
          {ctx.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <span className="meta" role="status">{status}</span>
      </div>
      {error && <p className="canvas-note err flow-alert" role="alert">{error} <button className="btn sm" onClick={() => { setError(''); refresh() }}>Erneut versuchen</button></p>}
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.2} maxZoom={2}
        panOnDrag={hand ? true : [1, 2]} selectionOnDrag={!hand} panOnScroll proOptions={{ hideAttribution: true }} colorMode="dark"
        deleteKeyCode={['Backspace', 'Delete']} isValidConnection={valid}
        onNodesChange={changeset => {
          // React Flow 13 hands over a changeset object, not an array.
          const changes = changeset.toArray()
          const moved = changes.filter(c => c.type === 'position' && c.position)
          if (moved.length) change(d => ({ nodes: d.nodes.map(node => { const c = moved.find(m => m.id === node.id); return c ? { ...node, x: Math.round(c.position.x), y: Math.round(c.position.y) } : node }) }))
          const measured = changes.filter(c => c.type === 'dimensions' && c.dimensions)
          if (measured.length) setSizes(prev => ({ ...prev, ...Object.fromEntries(measured.map(c => [c.id, c.dimensions])) }))
          const picks = changes.filter(c => c.type === 'select')
          if (picks.length) setSelected(prev => { const next = new Set(prev); for (const c of picks) c.selected ? next.add(c.id) : next.delete(c.id); return next })
          const gone = changes.filter(c => c.type === 'remove').map(c => c.id)
          if (gone.length) change(d => ({ nodes: d.nodes.filter(node => !gone.includes(node.id)), edges: d.edges.filter(edge => !gone.includes(edge.source) && !gone.includes(edge.target)) }))
        }}
        onEdgesChange={changeset => {
          const gone = changeset.toArray().filter(c => c.type === 'remove').map(c => c.id)
          if (gone.length) change(d => ({ edges: d.edges.filter(edge => !gone.includes(edge.id)) }))
        }}
        onConnect={c => change(d => ({ edges: connectEdges(d, { id: crypto.randomUUID(), source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle }) }))}
        onConnectEnd={(event, connection) => {
          if (connection.isValid || connection.toHandle || !connection.fromHandle || !connection.fromNode) return
          const side = connection.fromHandle.type
          const kind = portKind(connection.fromNode.id, connection.fromHandle.id, side)
          if (kind) openMenu(pointOf(event), { side, kind, nodeId: connection.fromNode.id, handle: connection.fromHandle.id })
        }}
        onPaneContextMenu={event => { event.preventDefault(); openMenu(pointOf(event), null) }} onPaneClick={() => setMenu(null)}
        onEdgeDoubleClick={(_, edge) => change(d => ({ edges: d.edges.filter(item => item.id !== edge.id) }))}>
        <Background gap={24} size={1} color="var(--c-hair)"/>
        <Controls showInteractive={false} position="bottom-right"/>
      </ReactFlow>
      {!doc.nodes.length && <div className="flow-start">
        <strong>Dieser Flow ist noch leer</strong>
        <p>Ein Flow verbindet Schritte mit Linien: Text wird zum Bild, das Bild zum Startbild eines Videos. Ergebnisse fließen über die Linien weiter, nichts läuft ohne deinen Klick auf „Ausführen“.</p>
        <div className="flow-row"><button className="btn primary" onClick={template}>Bild zu Video anlegen</button>
          <button className="btn" onClick={openCentered}>Knoten hinzufügen</button></div>
      </div>}
      <div className="flow-dock" role="toolbar" aria-label="Werkzeuge">
        <button className={'icon' + (!hand ? ' on' : '')} aria-pressed={!hand} aria-label="Auswählen" title="Auswählen" onClick={() => setHand(false)}><Icon name="pointer"/></button>
        <button className={'icon' + (hand ? ' on' : '')} aria-pressed={hand} aria-label="Verschieben" title="Verschieben (Hand)" onClick={() => setHand(true)}><Icon name="hand"/></button>
        <button className="btn sm" aria-haspopup="dialog" onClick={openCentered}><Icon name="plus"/>Knoten hinzufügen</button>
      </div>
      {menu && <AddMenu types={types} at={menu} filter={menu.filter} onClose={() => setMenu(null)} onPick={type => addNode(type, menu.position, menu.filter)}/>}
      {picker && <AssetPicker ctx={ctx} initial={state.data.nodes.find(n => n.id === picker)?.params?.assetIds ?? []} onClose={() => setPicker(null)}
        onDone={ids => { update(picker, n => ({ ...n, params: { ...n.params, assetIds: ids } })); setPicker(null) }}/>}
      {confirm && <Confirm steps={confirm.steps} onNo={() => setConfirm(null)} onYes={() => confirm.start().catch(e => setError(e.message))}/>}
    </div>
  </Actions.Provider>
}

function Page({ ctx, project }) {
  const [loaded, setLoaded] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    const path = '/projects/' + project + '/apps/'
    Promise.all([ctx.api(path + 'flow'), flowsApi('/nodes'), ctx.api(path + 'storyboard')])
      .then(([record, types, story]) => { if (active) setLoaded({ record, types, shots: Array.isArray(story.data.shots) ? story.data.shots : [] }) })
      .catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [attempt])
  if (error) return <p role="alert" className="canvas-note err">{error} <button className="btn sm" onClick={() => setAttempt(attempt + 1)}>Erneut versuchen</button></p>
  if (!loaded) return <div className="flow-shell flow-loading" role="status" aria-label="Flow lädt"><span/><span/><span/></div>
  return <ReactFlowProvider><Canvas ctx={ctx} project={project} {...loaded}/></ReactFlowProvider>
}

/** Mounts the editor for the project in the route (or the first project) and unmounts when the container leaves the page. */
export function mount(container, ctx) {
  const project = ctx.projects.find(item => item.id === ctx.params.get('project')) ?? ctx.projects[0]
  if (project && !ctx.params.get('project')) history.replaceState(null, '', route(project.id))
  const root = createRoot(container)
  const observer = new MutationObserver(() => { if (!container.isConnected) { observer.disconnect(); root.unmount() } })
  observer.observe(document.body, { childList: true, subtree: true })
  root.render(project ? <Page key={project.id} ctx={ctx} project={project.id}/>
    : <div className="flow-start static"><strong>Noch kein Projekt</strong><p>Ein Flow gehört zu einem Projekt. Lege über das Plus neben „Projekte“ eines an.</p></div>)
}
