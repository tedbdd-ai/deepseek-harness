/**
 * Flows editor: the canvas of one project. Node types come from `/creativity-flows/api/nodes`, the flow is saved to
 * `app_data(flow)` through the hub API, and runs start only from the Ausführen button of a node.
 *
 * Built on standard parts: React Flow for the canvas (changesets, sub-flows for frames, NodeToolbar, NodeResizer,
 * Panel, MiniMap, animated edges), React Flow UI for node chrome (BaseNode, BaseHandle, NodeStatusIndicator) and
 * shadcn for menus and dialogs (cmdk Command, Radix Popover and Dialog), all themed with the hub tokens
 * (apps/flows/ui/flows.css). Domain parts stay here: previews, reference chips, `@` mentions and the node bodies.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, MiniMap, NodeResizer, NodeToolbar, Panel, Position, useReactFlow, useViewportStore } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './ui/flows.css'
import {
  Archive, AudioLines, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Copy, Download, Hand, History, Image, LayoutGrid,
  AtSign, Link, Map as MapIcon, Maximize, Maximize2, Minus, MoreHorizontal, MousePointer2, Palette, Play, Plus, Scissors, SlidersHorizontal, Sparkles, Trash2, Type, Upload, User, Video, Volume2, VolumeX, X,
} from 'lucide-react'
import { BaseNode, BaseNodeContent, BaseNodeFooter, BaseNodeHeader, BaseNodeHeaderTitle } from '@/components/base-node'
import { BaseHandle } from '@/components/base-handle'
import { NodeStatusIndicator } from '@/components/node-status-indicator'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/utils'
import { absolute, adoptIntoFrames } from './engine/frames.mjs'
import { implicitEdges, mentions, textHandle } from './engine/mentions.mjs'

const flowsApi = async (path, method = 'GET', body) => {
  const response = await fetch('/creativity-flows/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.error || `Flows antwortet mit ${response.status}.`)
  return data
}
const mediaUrl = id => '/creativity-hub/api/media/' + encodeURIComponent(id)
const route = (project, page = 'flows') => `#/${page}?project=${encodeURIComponent(project)}`

/**
 * Step pages: one phase of the film as its own sidebar entry, on the same flow. A step page shows only its phase frame
 * (and the free nodes); the other phases stay in the flow untouched. Frames carry `params.phase`; older frames are
 * recognised by their name.
 */
export const steps = {
  moodboard: { title: 'Moodboard', name: /mood/i, empty: 'Hier sammelst du Bilder, Farben und Notizen ohne Linien. Die Style-DNA macht daraus @Look für alle späteren Schritte.' },
  storyboard: { title: 'Storyboard', name: /story/i, empty: 'Story und Regie werden hier zur Shotliste. Unten im Filmstreifen siehst du jede Einstellung mit Keyframe, Video und Status.' },
  cast: { title: 'Figur und Set', name: /figur|set|cast/i, empty: 'Hier entstehen Charakterblatt und Set. Als Projekt-Assets wirken sie mit @Figur und @Set in jedem Prompt.' },
  voice: { title: 'Stimme', name: /stimme|voice|ton/i },
  shots: { title: 'Videos', name: /video|dreh|shot/i },
  edit: { title: 'Schnitt', name: /schnitt|edit/i },
}
/**
 * Grows a frame to at least `width` × `height` and moves every top-level node right of its old right edge (frames
 * included, with their content) by the added width, so a growing phase never runs into the next one. Nodes in `stay`
 * (the new content that made the frame grow) keep their place.
 * @returns {object[]} the new node list.
 */
function growFrame(nodes, frameId, width, height, stay = new Set()) {
  const frame = nodes.find(node => node.id === frameId)
  if (!frame) return nodes
  const before = Number(frame.params?.width) || 640
  const wider = Math.max(0, Math.ceil(width / 8) * 8 - before)
  const taller = Math.max(Number(frame.params?.height) || 480, Math.ceil(height / 8) * 8)
  const edge = frame.x + before
  return nodes.map(node => {
    if (node.id === frameId) return { ...node, params: { ...node.params, width: before + wider, height: taller } }
    return wider && !node.parentId && !stay.has(node.id) && node.x >= edge ? { ...node, x: node.x + wider } : node
  })
}

/**
 * Shots in the order of a storyboard grid: rows from top to bottom (nodes less than 160 px apart in height share a
 * row), each row left to right. Children of frames count at their absolute place.
 */
function readingOrderOf(list, byId) {
  const placed = list.map(node => ({ ...absolute(node, byId), node })).sort((a, b) => a.y - b.y)
  let row = 0
  placed.forEach((item, i) => { if (i && item.y - placed[i - 1].y >= 160) row++; item.row = row })
  return placed.sort((a, b) => (a.row - b.row) || (a.x - b.x)).map(item => item.node)
}
const phaseOf = frame => frame.params?.phase ?? Object.entries(steps).find(([, item]) => item.name.test(String(frame.name ?? '')))?.[0] ?? null

// Node types name their icon; the editor maps the names onto Lucide, the one icon pack of the canvas.
const icons = { text: Type, image: Image, video: Video, audio: AudioLines, library: Archive, board: LayoutGrid, shot: Clapperboard,
  composition: Scissors, color: Palette, link: Link, sparkle: Sparkles, person: User }
const Icon = ({ name, className = 'size-4' }) => { const Glyph = icons[name] ?? Plus; return <Glyph className={className} aria-hidden="true"/> }

const kindNames = { text: 'Text', image: 'Bild', video: 'Video', audio: 'Ton' }
const groups = [['board', 'Board'], ['source', 'Quellen'], ['text', 'Text'], ['image', 'Bild'], ['video', 'Video'], ['audio', 'Ton']]
const statusNames = { waiting: 'Wartet', running: 'Läuft', done: 'Fertig', failed: 'Fehler' }
const Actions = createContext(null)

const nodeName = (node, type) => String(node.name ?? '').trim() || type?.title || 'Knoten'
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
/** cmdk filter: plain substring match on the item text, so „char“ finds Charakterblatt and nothing that merely shares letters. */
const contains = (value, search) => (value.toLocaleLowerCase('de').includes(search.trim().toLocaleLowerCase('de')) ? 1 : 0)
const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

/**
 * A Library file drawn with the hub's own media element (image, video with controls, audio, link card). Pictures are not
 * draggable: a native image drag would carry a file and land as a copy on the canvas.
 */
function Media({ asset, ctx, full = false, className }) {
  const host = useRef(null)
  useEffect(() => {
    if (!asset) return
    host.current.replaceChildren(full ? ctx.media(asset, { full: true }) : ctx.media(asset))
    host.current.querySelectorAll('img, video').forEach(item => { item.draggable = false })
  }, [asset, ctx, full])
  return <div ref={host} className={cn('flow-media', className)}/>
}

/**
 * Fullscreen view of the files of one node: arrow keys or the buttons page through, Esc closes. On a Datei node the
 * shown file can be taken out of the node (it stays in the Library).
 */
function Viewer({ ids, index, nodeId, onIndex, onClose }) {
  const { ctx, assets, removeAsset } = useContext(Actions)
  const list = ids.filter(id => assets[id])
  const at = Math.min(index, list.length - 1)
  const asset = assets[list[at]]
  if (!asset) return null
  const step = delta => onIndex((at + delta + list.length) % list.length)
  const kind = asset.media_type?.split('/')[0]
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flow-viewer" onKeyDown={event => {
      if (list.length > 1 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1) }
    }}>
      <DialogHeader className="min-w-0 pr-12">
        <DialogTitle className="truncate">{asset.title || 'Ohne Titel'}</DialogTitle>
        <DialogDescription>{[kindNames[kind], list.length > 1 && `${at + 1} von ${list.length}`].filter(Boolean).join(' · ')}</DialogDescription>
      </DialogHeader>
      <div className="flow-viewer-stage"><Media key={asset.id} asset={asset} ctx={ctx} full/></div>
      <DialogFooter className="items-center sm:justify-between">
        <div className="flex gap-2">{list.length > 1 && <>
          <Button variant="outline" size="icon" aria-label="Vorherige Datei" title="Vorherige (←)" onClick={() => step(-1)}><ChevronLeft/></Button>
          <Button variant="outline" size="icon" aria-label="Nächste Datei" title="Nächste (→)" onClick={() => step(1)}><ChevronRight/></Button>
        </>}</div>
        <div className="flex flex-wrap gap-2">
          {nodeId && <Button variant="outline" className="text-destructive" onClick={() => {
            removeAsset(nodeId, asset.id)
            if (list.length === 1) onClose(); else onIndex(Math.min(at, list.length - 2))
          }}><X/>Aus dem Knoten entfernen</Button>}
          <Button asChild variant="outline"><a href={mediaUrl(asset.id)} download className="no-underline"><Download/>Download</a></Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function Seconds({ since }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return since ? <span className="tabular-nums">{Math.max(0, Math.round((now - Date.parse(since)) / 1000))} s</span> : null
}

function Preview({ type, view }) {
  const { ctx, assets, openViewer } = useContext(Actions)
  const [page, setPage] = useState(0)
  const media = type.outputs.filter(port => port.kind !== 'text').flatMap(port => view?.outputs?.[port.id] ?? []).filter(id => assets[id])
  const busy = view?.status === 'running' || view?.status === 'waiting'
  useEffect(() => setPage(0), [media.join()])
  if (!media.length) {
    return <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md bg-background p-4 text-center text-sm text-muted-foreground">
      <Icon name={type.outputs[0]?.kind ?? 'image'} className="size-5"/>
      <span>{busy ? <>{statusNames[view.status]} <Seconds since={view.startedAt}/></> : 'Hier erscheint dein Ergebnis.'}</span>
    </div>
  }
  const shown = media[Math.min(page, media.length - 1)]
  return <div className="group/preview relative overflow-hidden rounded-md bg-background" onDoubleClick={() => openViewer({ ids: media, index: media.indexOf(shown) })}>
    <Button variant="secondary" size="icon-sm" className="nodrag absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover/preview:opacity-100 focus-visible:opacity-100"
      aria-label="Im Vollbild ansehen" title="Vollbild (Doppelklick)" onClick={() => openViewer({ ids: media, index: media.indexOf(shown) })}><Maximize2/></Button>
    <Media asset={assets[shown]} ctx={ctx} full/>
    {busy && <span className="absolute left-2 top-2 rounded-sm bg-[var(--c-scrim)] text-[var(--c-on-scrim)] px-2 py-0.5 text-xs">{statusNames[view.status]} <Seconds since={view.startedAt}/></span>}
    {media.length > 1 && <div className="nodrag absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-[var(--c-scrim)] text-[var(--c-on-scrim)] p-0.5 text-xs tabular-nums">
      <Button variant="ghost" size="icon-sm" aria-label="Vorheriges Ergebnis" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft/></Button>
      <span>{page + 1} / {media.length}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Nächstes Ergebnis" disabled={page >= media.length - 1} onClick={() => setPage(page + 1)}><ChevronRight/></Button>
    </div>}
  </div>
}

/** Answer of a text-only run node (LLM, Style-DNA): readable, selectable and copyable. */
function TextResult({ view }) {
  const { ctx } = useContext(Actions)
  const text = (view?.outputs?.text ?? []).join('\n\n')
  const busy = view?.status === 'running' || view?.status === 'waiting'
  if (!text) {
    return <div className="flex min-h-24 items-center justify-center rounded-md bg-background p-4 text-center text-sm text-muted-foreground">
      {busy ? <span>{statusNames[view.status]} <Seconds since={view.startedAt}/></span> : 'Hier erscheint die Antwort.'}</div>
  }
  return <div className="group/answer relative">
    <div className="flow-answer nodrag nowheel" tabIndex={0} aria-label="Antwort">{text}</div>
    <Button variant="secondary" size="icon-sm" className="nodrag absolute right-2 top-2 opacity-0 transition-opacity group-hover/answer:opacity-100 focus-visible:opacity-100"
      aria-label="Antwort kopieren" title="Kopieren" onClick={() => navigator.clipboard?.writeText(text).then(() => ctx.toast('Antwort kopiert.'), () => ctx.toast('Kopieren ging nicht.', true))}><Copy/></Button>
  </div>
}

/**
 * Result of the Regie node: the shots as a compact list and the figures and places it needs; „Szenen anlegen“ turns
 * the shots into Szene nodes. Scenes made before are updated in place, after a second click, so their lines stay.
 */
function ShotList({ node, view }) {
  const { spawnScenes, sceneCount } = useContext(Actions)
  const [sure, setSure] = useState(false)
  const shots = view?.data?.shots ?? []
  const needed = view?.data?.assets ?? []
  const made = sceneCount(node.id)
  useEffect(() => setSure(false), [view?.history?.[0]?.at, made])
  if (!shots.length) return view?.outputs?.text?.length || view?.status === 'running' || view?.status === 'waiting' ? <TextResult view={view}/> : null
  return <div className="[display:grid] gap-2">
    <ol className="flow-shots nodrag nowheel" aria-label="Shotliste">{shots.map((shot, i) => <li key={i}>
      <span className="flow-shot-head"><b>{i + 1} · {shot.title}</b><span className="tabular-nums">{shot.duration} s{shot.shot ? ' · ' + shot.shot : ''}</span></span>
      <span>{shot.prompt}</span>{shot.motion && <span className="text-muted-foreground">{shot.motion}</span>}
    </li>)}</ol>
    {needed.length > 0 && <p className="text-xs text-muted-foreground">Braucht: {needed.map(item => '@' + item.name).join(', ')}</p>}
    <Button variant={sure ? 'default' : 'outline'} size="sm" className="nodrag justify-self-start" onClick={() => {
      if (made && !sure) { setSure(true); return }
      spawnScenes(node.id); setSure(false)
    }}>{sure ? `${made} Szenen überschreiben?` : made ? `Szenen aktualisieren (${shots.length})` : `Szenen anlegen (${shots.length})`}</Button>
  </div>
}

function RunButton({ node, view, first = 'Ausführen', again = 'Neu ausführen' }) {
  const { run } = useContext(Actions)
  const [open, setOpen] = useState(false)
  const busy = view?.status === 'running' || view?.status === 'waiting'
  const label = view?.status === 'failed' ? 'Erneut ausführen' : view?.status === 'done' ? again : first
  return <div className="nodrag flex">
    <Button size="sm" className="rounded-r-none" disabled={busy} onClick={() => run(node.id, 'node')}><Play/>{busy ? statusNames[view.status] : label}</Button>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="icon-sm" className="ml-px rounded-l-none" aria-label="Weitere Arten auszuführen" disabled={busy}><ChevronDown/></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <Command><CommandList>
          <CommandItem onSelect={() => { setOpen(false); run(node.id, 'upstream') }}>Mit fehlenden Schritten davor</CommandItem>
          <CommandItem onSelect={() => { setOpen(false); run(node.id, 'downstream') }}>Ab hier alles danach</CommandItem>
        </CommandList></Command>
      </PopoverContent>
    </Popover>
  </div>
}

function Ports({ ports, side, connected, nodeId }) {
  const { portMenu } = useContext(Actions)
  // A click (without dragging) on a port opens the menu of nodes that fit it; dragging still draws a line.
  return ports.map((port, i) => {
    const handle = { nodeId, handle: port.id, kind: port.kind, side: side === 'in' ? 'target' : 'source' }
    return <BaseHandle key={port.id} id={port.id} type={side === 'in' ? 'target' : 'source'} position={side === 'in' ? Position.Left : Position.Right}
      className={'flow-port kind-' + port.kind + (connected.has(port.id) ? ' on' : '')} style={{ top: 56 + i * 40 }}
      title={port.label + ' (' + kindNames[port.kind] + (port.multiple ? ', mehrere' : '') + '). Klicken für passende Knoten, ziehen zum Verbinden.'}
      aria-label={port.label} role="button" tabIndex={0}
      onClick={event => portMenu(event, handle)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); portMenu(event, handle) } }}>
      <Icon name={port.kind} className="pointer-events-none size-3"/>
    </BaseHandle>
  })
}

/**
 * Select for long option lists such as models: shadcn Command (search, keyboard) in a Popover, with quick filters
 * made from the options' `tags`.
 */
function Picker({ field, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [tag, setTag] = useState('')
  const options = field.options ?? []
  const current = options.find(option => optionValue(option) === value)
  const tags = [...new Set(options.flatMap(option => option.tags ?? []))]
  const shown = options.filter(option => !tag || option.tags?.includes(tag))
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" className="max-w-60" title={field.label}>
      <span className="truncate">{current ? optionLabel(current) : field.label + ' wählen'}</span><ChevronDown/></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[360px] p-0">
      <Command filter={contains}>
        <CommandInput placeholder={field.label + ' suchen'}/>
        {tags.length > 1 && <div className="flex flex-wrap gap-1 border-b p-2">{tags.map(item =>
          <Button key={item} variant={tag === item ? 'default' : 'outline'} size="sm" className="rounded-full" aria-pressed={tag === item} onClick={() => setTag(tag === item ? '' : item)}>{item}</Button>)}</div>}
        <CommandList>
          <CommandEmpty>{options.length ? 'Nichts gefunden. Ändere Suche oder Filter.' : field.empty ?? 'Keine Auswahl verfügbar.'}</CommandEmpty>
          {shown.map(option => <CommandItem key={optionValue(option)} value={optionLabel(option) + ' ' + (option.tags ?? []).join(' ')} data-checked={optionValue(option) === value}
            onSelect={() => { onChange(optionValue(option)); setOpen(false) }} className="flex-col items-start gap-0.5">
            <span>{optionLabel(option)}</span>{option.tags?.length > 0 && <span className="text-xs text-muted-foreground">{option.tags.join(' · ')}</span>}</CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}

/**
 * Prompt field with `@` mentions: typing `@` lists what can be mentioned here, and a choice is inserted as `@Bild1` (one
 * connected file, the mark the model reads) or `@Name` (all files of a node; the engine turns it into their marks when
 * the node runs). `names` holds `{ name, hint?, asset? }`.
 */
function PromptField({ node, type, names }) {
  const { update, ctx, assets } = useContext(Actions)
  const field = useRef(null)
  const [query, setQuery] = useState(null)
  const [active, setActive] = useState(0)
  const matches = query === null ? [] : names.filter(item => item.name.toLocaleLowerCase('de').startsWith(query.toLocaleLowerCase('de'))).slice(0, 8)
  function track(element) {
    const found = /@([\p{L}\p{N} _-]{0,32})$/u.exec(element.value.slice(0, element.selectionStart))
    setQuery(found && names.length ? found[1] : null)
    setActive(0)
  }
  function insert(name) {
    const element = field.current
    const before = element.value.slice(0, element.selectionStart).replace(/@([\p{L}\p{N} _-]{0,32})$/u, '@' + name + ' ')
    const value = before + element.value.slice(element.selectionStart)
    update(node.id, n => ({ ...n, prompt: value }))
    setQuery(null)
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(before.length, before.length) })
  }
  const placeholder = node.type === 'text' ? 'Idee, Story oder Prompt. Mit @ nennst du eine Datei oder ein Bild.'
    : node.type === 'scene' ? 'Was passiert in dieser Einstellung? Mit @ nennst du Figur, Ort oder Look.'
      : names.length ? 'Beschreibe, was entstehen soll. Mit @ sprichst du eine Referenz an.' : 'Beschreibe, was entstehen soll.'
  return <div className="nodrag relative">
    <textarea ref={field} className="flow-prompt nowheel" rows={node.type === 'text' ? 6 : 3} aria-label={nodeName(node, type) + ': Text'}
      placeholder={placeholder} value={node.prompt ?? ''}
      onChange={e => { update(node.id, n => ({ ...n, prompt: e.target.value })); track(e.target) }}
      onKeyDown={e => {
        if (!matches.length) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length) }
        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[active].name) }
        else if (e.key === 'Escape') setQuery(null)
      }}
      onBlur={() => setTimeout(() => setQuery(null), 150)}/>
    {matches.length > 0 && <div role="listbox" aria-label="Referenz einfügen" className="absolute left-0 top-full z-10 mt-1 [display:grid] min-w-48 rounded-md border bg-popover p-1 text-popover-foreground">
      {matches.map((item, i) => <button key={item.name} role="option" aria-selected={i === active}
        className={cn('flow-ref flex min-h-9 items-center gap-2 rounded-sm px-2 text-left text-sm', i === active ? 'bg-accent' : 'hover:bg-accent')}
        onMouseDown={e => { e.preventDefault(); insert(item.name) }}>
        {item.asset && assets[item.asset] && <Media asset={assets[item.asset]} ctx={ctx}/>}
        <span className="font-medium">@{item.name}</span>{item.hint && <span className="max-w-40 truncate text-xs text-muted-foreground">{item.hint}</span>}</button>)}
    </div>}
  </div>
}

/** Reference chips of a run node: mark, thumbnail and title of each connected file; a click puts its mark (`@Bild1`) into the prompt. */
function References({ node, view }) {
  const { ctx, assets, update, openViewer } = useContext(Actions)
  const [all, setAll] = useState(false)
  const refs = view?.refs ?? []
  if (!refs.length) return null
  const shown = all || refs.length <= 5 ? refs : refs.slice(0, 4)
  const chip = 'flow-ref h-8 gap-1 px-2 pl-0.5 text-xs font-normal'
  return <div className="nodrag flex flex-wrap gap-1" aria-label="Referenzen">
    {shown.map(ref => {
      const title = assets[ref.value]?.title || ref.name
      return <Button key={ref.mark} variant="outline" size="sm" className={chip + ' max-w-full'} title={`${ref.mark} ist „${title}“ aus „${ref.name}“. Klicken fügt ${ref.mark} in den Prompt ein, Doppelklick zeigt die Datei groß.`}
        onClick={() => update(node.id, n => ({ ...n, prompt: ((n.prompt ?? '').replace(/\s*$/, '') + ' ' + ref.mark + ' ').trimStart() }))}
        onDoubleClick={() => assets[ref.value] && openViewer({ ids: refs.map(item => item.value), index: refs.indexOf(ref) })}>
        {assets[ref.value] && <Media asset={assets[ref.value]} ctx={ctx}/>}<span className="truncate"><b className="font-medium text-foreground">{ref.mark}</b> {title}</span></Button>
    })}
    {refs.length > shown.length && <Button variant="outline" size="sm" className={chip + ' pl-2'} onClick={() => setAll(true)}>+{refs.length - shown.length} weitere</Button>}
    {all && refs.length > 5 && <Button variant="outline" size="sm" className={chip + ' pl-2'} onClick={() => setAll(false)}>Weniger</Button>}
  </div>
}

/**
 * The files of a Datei or Szene node. Each file shows Vollbild and Entfernen on hover or focus; a double-click opens the
 * fullscreen view, where the arrow keys page through all files of the node.
 */
function AssetStrip({ node, single }) {
  const { ctx, pickAssets, uploadAssets, assets, openViewer, removeAsset } = useContext(Actions)
  const ids = node.params?.assetIds ?? []
  const shown = ids.filter(id => assets[id])
  const limit = shown.length > 8 ? 7 : 8
  const open = index => openViewer({ ids: shown, index, nodeId: node.id })
  const label = id => { const title = assets[id].title || 'Datei'; return title.length > 48 ? title.slice(0, 47) + '…' : title }
  const tile = (id, index, big) => <div key={id} className={cn('flow-file group/file relative overflow-hidden', big ? 'rounded-md bg-background' : 'rounded-[6px]')} onDoubleClick={() => open(index)}>
    <Media asset={assets[id]} ctx={ctx} full={big}/>
    <div className="nodrag absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover/file:opacity-100 group-focus-within/file:opacity-100">
      {big && <Button variant="secondary" size="icon-sm" aria-label={`${label(id)} im Vollbild ansehen`} title="Vollbild (Doppelklick)" onClick={() => open(index)}><Maximize2/></Button>}
      <Button variant="secondary" size={big ? 'icon-sm' : 'icon-xs'} aria-label={`${label(id)} aus dem Knoten entfernen`} title="Aus dem Knoten entfernen" onClick={() => removeAsset(node.id, id)}><X/></Button>
    </div>
  </div>
  return <>
    {shown.length === 1 ? tile(shown[0], 0, true)
      : shown.length > 1 && <div className="flow-thumbs [display:grid] grid-cols-4 gap-1">
        {shown.slice(0, limit).map((id, index) => tile(id, index, false))}
        {shown.length > limit && <Button variant="outline" className="nodrag aspect-square h-auto rounded-[6px] p-0 text-sm tabular-nums" aria-label={`Alle ${shown.length} Dateien ansehen`} onClick={() => open(limit)}>+{shown.length - limit}</Button>}
      </div>}
    {ids.length > shown.length && <p className="text-xs text-muted-foreground">{ids.length - shown.length === 1 ? 'Eine Datei gibt es nicht mehr in der Library.' : `${ids.length - shown.length} Dateien gibt es nicht mehr in der Library.`}</p>}
    <div className="nodrag flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => pickAssets(node, single)}>{single ? (ids.length ? 'Startbild ändern' : 'Startbild wählen') : ids.length ? `${ids.length} gewählt · Ändern` : 'Aus der Library wählen'}</Button>
      {!single && <Button variant="outline" size="sm" onClick={() => uploadAssets(node)}><Upload/>Hochladen</Button>}
      {shown.length > 1 && <Button variant="outline" size="sm" onClick={() => open(0)}><Maximize2/>Ansehen</Button>}
    </div>
  </>
}

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm'

function NodeBody({ node, type }) {
  const { update } = useContext(Actions)
  const set = (key, value) => update(node.id, n => ({ ...n, params: { ...n.params, [key]: value } }))
  if (node.type === 'library') return <AssetStrip node={node}/>
  if (node.type === 'scene') {
    const duration = type.fields.find(field => field.key === 'duration')
    return <>
      <AssetStrip node={node} single/>
      <label className="nodrag [display:grid] grid-cols-[1fr_144px] items-center gap-2 text-sm text-muted-foreground"><span>Dauer</span>
        <select className={selectClass} value={node.params?.duration ?? duration.default} onChange={e => set('duration', e.target.value)}>
          {duration.options.map(option => <option key={option} value={option}>{option} s</option>)}</select></label>
    </>
  }
  if (node.type === 'color') {
    const color = /^#[0-9a-f]{6}$/i.test(node.params?.color ?? '') ? node.params.color : '#8A6A4F'
    return <>
      <div className="h-24 rounded-md border" style={{ backgroundColor: color }}/>
      <label className="nodrag flex items-center justify-between text-sm text-muted-foreground"><span className="tabular-nums">{color.toUpperCase()}</span>
        <input type="color" aria-label="Farbton" className="h-8 w-11 cursor-pointer rounded-sm border border-input bg-transparent p-0" value={color} onChange={e => set('color', e.target.value)}/></label>
    </>
  }
  if (node.type === 'link') {
    const url = node.params?.url ?? ''
    return <div className="nodrag [display:grid] gap-2">
      <input className="text-in" type="url" aria-label="Adresse" placeholder="https://…" value={url} onChange={e => set('url', e.target.value.trim())}/>
      {/^https?:\/\//i.test(url) && <a className="text-sm text-muted-foreground hover:text-foreground" href={url} target="_blank" rel="noreferrer">{domainOf(url)} öffnen</a>}
    </div>
  }
  return null
}

/** Header above the card (ElevenLabs layout): type icon and name left, model or a short fact right; doubles as drag handle and rename field. */
function NodeHeader({ node, type, right, className }) {
  const { rename, renaming, setRenaming } = useContext(Actions)
  const editing = renaming === node.id
  return <header className={cn('flow-drag flex h-7 cursor-grab items-center gap-1.5 px-1 text-sm text-muted-foreground', className)}>
    <Icon name={type.icon} className="size-3.5 shrink-0"/>
    {editing
      ? <input autoFocus className="nodrag h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-xs text-foreground" defaultValue={node.name ?? ''} placeholder={type.title}
        aria-label="Name des Knotens" maxLength={40}
        onBlur={e => { rename(node.id, e.target.value.trim()); setRenaming(null) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }}/>
      : node.asset
        ? <span className="flow-asset truncate" onDoubleClick={() => setRenaming(node.id)} title={`Projekt-Asset: @${nodeName(node, type)} wirkt in jedem Prompt, auch ohne Linie. Doppelklick zum Umbenennen.`}>@{nodeName(node, type)}</span>
        : <span className="truncate font-medium text-secondary-foreground" onDoubleClick={() => setRenaming(node.id)} title="Doppelklick zum Umbenennen">{nodeName(node, type)}</span>}
    {right && <span className="ml-auto max-w-[55%] truncate tabular-nums">{right}</span>}
  </header>
}

/** A frame is a React Flow group node: its children (`parentId`) move with it and lie inside it. */
/**
 * A frame zoomed far out (the storyboard overview): a poster with the phase title, what is inside and up to four
 * pictures, generated results first, then references. Text is counter-scaled so it stays readable; a click opens the phase.
 */
function FramePoster({ node, type, story }) {
  const { ctx, assets, focusFrame } = useContext(Actions)
  const zoom = useViewportStore(store => store.transform[2])
  const name = nodeName(node, type)
  // Text grows as the canvas shrinks, but never wider than the frame allows (narrow phases such as Schnitt).
  const width = Number(node.params?.width) || 640
  const size = (screen, share) => Math.min(screen / zoom, width * share)
  const facts = [story.nodes === 1 ? '1 Knoten' : `${story.nodes} Knoten`, story.made ? (story.made === 1 ? '1 Ergebnis' : `${story.made} Ergebnisse`) : 'noch kein Ergebnis'].join(' · ')
  return <button type="button" className="flow-poster" onClick={() => focusFrame(node)} aria-label={`${name} öffnen. ${facts}`}>
    <span className="flow-poster-title" style={{ fontSize: size(22, 0.2) }}>{name}</span>
    <span className="flow-poster-facts" style={{ fontSize: size(13, 0.09) }}>{facts}</span>
    {story.cover.length > 0
      ? <span className="flow-poster-cover" style={{ gridTemplateColumns: `repeat(${Math.min(story.cover.length, 4)}, minmax(0, 1fr))` }}>
        {story.cover.map(id => <Media key={id} asset={assets[id]} ctx={ctx}/>)}</span>
      : <span className="flow-poster-empty" style={{ fontSize: size(13, 0.09) }}>Noch keine Bilder in dieser Phase</span>}
  </button>
}

function FrameNode({ id, data, selected }) {
  const { update, remove, edges } = useContext(Actions)
  const { node, type, view, story } = data
  const glance = useViewportStore(store => store.transform[2] < 0.35)
  if (glance && story) return <section className="flow-frame flow-frame-poster" aria-label={nodeName(node, type)}><FramePoster node={node} type={type} story={story}/></section>
  const count = Object.values(view?.outputs ?? {}).reduce((sum, list) => sum + list.length, 0)
  return <section className={cn('flow-frame', selected && 'active')} aria-label={nodeName(node, type)}>
    <NodeResizer isVisible={selected} minWidth={320} minHeight={240} lineClassName="flow-resize-line" handleClassName="flow-resize-handle"
      onResizeEnd={(_, size) => update(id, n => ({ ...n, x: Math.round(size.x), y: Math.round(size.y), params: { ...n.params, width: Math.round(size.width / 8) * 8, height: Math.round(size.height / 8) * 8 } }), true)}/>
    <NodeHeader node={node} type={type} right={count === 1 ? '1 Wert darin' : `${count} Werte darin`} className="flow-frame-head"/>
    <Ports ports={type.outputs} side="out" nodeId={id} connected={new Set(edges.filter(edge => edge.source === id).map(edge => edge.sourceHandle))}/>
    <NodeToolbar isVisible={selected} position={Position.Top} align="start" className="nodrag flex items-center gap-1 rounded-lg border bg-popover p-1">
      <NodeMenu node={node} type={type} view={view}/>
      <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Rahmen löschen, Inhalt bleibt" title="Rahmen löschen (Inhalt bleibt)" onClick={() => remove(id)}><Trash2/></Button>
    </NodeToolbar>
  </section>
}

/** Settings shown in the toolbar at all times: format, resolution, length, count and sound; the rest sits behind „Mehr“. */
const quickKey = /aspect|resolution|duration|count|quality|size|format|^n$/i
const valueLabel = (field, value) => {
  const option = field.options?.find(item => String(optionValue(item)) === String(value))
  const label = option ? optionLabel(option) : String(value)
  if (/duration/i.test(field.key)) return label + ' s'
  if (field.key === 'count') return label + '×'
  return label
}

function QuickSetting({ node, field }) {
  const { update } = useContext(Actions)
  const value = fieldValue(node, field)
  if (field.type === 'boolean') {
    const Glyph = /audio|sound/i.test(field.key) ? (value ? Volume2 : VolumeX) : null
    return <Button variant="ghost" size={Glyph ? 'icon-sm' : 'sm'} aria-pressed={Boolean(value)} aria-label={field.label} title={field.label}
      className={cn(!value && 'text-muted-foreground')} onClick={() => update(node.id, n => withField(n, field, !fieldValue(n, field)))}>{Glyph ? <Glyph/> : field.label}</Button>
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="px-2 tabular-nums" title={field.label} aria-label={`${field.label}: ${valueLabel(field, value)}`}>{valueLabel(field, value)}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-40">
      <DropdownMenuLabel className="text-xs text-muted-foreground">{field.label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={String(value)} onValueChange={next => update(node.id, n => withField(n, field, next))}>
        {field.options.map(option => <DropdownMenuRadioItem key={optionValue(option)} value={String(optionValue(option))}>{valueLabel(field, optionValue(option))}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}

/** The ⋯ menu: rarely used node actions with their shortcuts, as in ElevenLabs Flows. */
function NodeMenu({ node, type, view }) {
  const { run, remove, duplicate, copyNodes, pasteNodes, focusNode, setRenaming, pick, toggleAsset } = useContext(Actions)
  const media = type.outputs.filter(port => port.kind !== 'text').flatMap(port => view?.outputs?.[port.id] ?? [])[0]
  // The menu hands focus back to its trigger when it closes; a rename starts only after that, or the name field would lose focus at once.
  const renameNext = useRef(false)
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen" title="Weitere Aktionen"><MoreHorizontal/></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={event => { if (renameNext.current) { event.preventDefault(); renameNext.current = false; setRenaming(node.id) } }}>
      {type.runs && <DropdownMenuItem onSelect={() => run(node.id, 'node')}>Ausführen<DropdownMenuShortcut>⌘↩</DropdownMenuShortcut></DropdownMenuItem>}
      {!type.runs && !type.contains && <DropdownMenuItem onSelect={() => run(node.id, 'downstream')}>Ab hier ausführen</DropdownMenuItem>}
      <DropdownMenuItem disabled={!media} asChild={Boolean(media)}>{media ? <a href={mediaUrl(media)} download>Download<DropdownMenuShortcut>⌘⇧D</DropdownMenuShortcut></a> : <span>Download</span>}</DropdownMenuItem>
      {(view?.history?.length ?? 0) > 1 && <DropdownMenuSub>
        <DropdownMenuSubTrigger>Frühere Ergebnisse</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{view.history.map((entry, i) => <DropdownMenuItem key={entry.at + i} onSelect={() => pick(node.id, i)}>
          {new Date(entry.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{i === 0 ? ' · neuestes' : ''}</DropdownMenuItem>)}</DropdownMenuSubContent>
      </DropdownMenuSub>}
      <DropdownMenuSeparator/>
      <DropdownMenuItem onSelect={() => { renameNext.current = true }}>Umbenennen</DropdownMenuItem>
      {!type.contains && <DropdownMenuItem onSelect={() => { if (toggleAsset(node.id)) renameNext.current = true }}>
        {node.asset ? 'Projekt-Asset lösen' : 'Als Projekt-Asset festlegen'}</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => copyNodes([node.id])}>Kopieren<DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => pasteNodes()}>Einfügen<DropdownMenuShortcut>⌘V</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => duplicate(node.id)}>Duplizieren<DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => focusNode(node.id)}>Knoten fokussieren<DropdownMenuShortcut>⌘.</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuSeparator/>
      <DropdownMenuItem variant="destructive" onSelect={() => remove(node.id)}>Knoten löschen<DropdownMenuShortcut>⌫</DropdownMenuShortcut></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

/**
 * Dot grid with a constant look on screen, like Figma or ElevenLabs: React Flow scales gap and dot with the zoom, so the
 * dot size is divided by the zoom (always about 1 px) and the gap doubles whenever it would fall under 20 px on screen.
 * Far out (below 25 %) the grid goes away.
 */
function Grid() {
  const zoom = useViewportStore(store => store.transform[2])
  if (zoom < 0.25) return null
  const step = 2 ** Math.max(0, Math.ceil(Math.log2(20 / (24 * zoom))))
  return <Background gap={24 * step} size={1.2 / zoom} color="var(--c-dot)"/>
}

/**
 * Level of detail by zoom (React Flow's contextual zoom): the toolbar under the node scales with the canvas and goes away
 * below 60 %; below 35 % the card keeps only its header and pictures.
 */
const detailOf = zoom => (zoom >= 0.6 ? 'full' : zoom >= 0.35 ? 'card' : 'glance')

function FlowNode({ id, data, selected }) {
  const { update, remove, duplicate, run, edges, mentionNames, assets, assetNames } = useContext(Actions)
  const detail = useViewportStore(store => detailOf(store.transform[2]))
  const { node, type, view } = data
  if (!type) {
    return <div className="w-80"><header className="flow-drag flex h-7 items-center px-1 text-xs text-muted-foreground">Unbekannter Knoten</header>
      <BaseNode className="border-dashed"><BaseNodeContent><p className="flow-error">Die Knotenart „{node.type}“ ist gerade nicht geladen. Prüfe, ob ihr Plugin läuft.</p>
        <Button variant="outline" size="sm" className="nodrag self-start text-destructive" onClick={() => remove(id)}>Entfernen</Button></BaseNodeContent></BaseNode></div>
  }
  const model = modelOf(node, type)
  const modelField = type.fields.find(field => field.key === 'modelId')
  const modelName = modelField && optionLabel(modelField.options.find(option => optionValue(option) === model) ?? '')
  const inbound = new Set(edges.filter(edge => edge.target === id).map(edge => edge.targetHandle))
  const outbound = new Set(edges.filter(edge => edge.source === id).map(edge => edge.sourceHandle))
  // A Library node shows only the outputs that carry files or lines; with nothing chosen it shows all three.
  const used = node.type === 'library' ? type.outputs.filter(port => view?.outputs?.[port.id]?.length || outbound.has(port.id)) : []
  const outputs = used.length ? used : type.outputs
  const settings = type.runs ? type.fields.filter(field => field.key !== 'modelId' && (field.type === 'enum' || field.type === 'boolean') && (!field.model || field.model === model)) : []
  const quick = settings.filter(field => quickKey.test(field.key) || /audio|sound/i.test(field.key)).slice(0, 4)
  const more = settings.filter(field => !quick.includes(field))
  const firstMedia = type.outputs.filter(port => port.kind !== 'text').flatMap(port => view?.outputs?.[port.id] ?? [])[0]
  const tall = Math.max(type.inputs.length, outputs.length)
  const state = view?.stale ? 'Veraltet' : statusNames[view?.status] ?? ''
  // Run nodes can mention what is connected to them and every project asset; notes and scenes can mention every file
  // node and asset, resolved where the text arrives.
  const refs = view?.refs ?? []
  const own = new Set(refs.map(ref => ref.name))
  const projectAssets = assetNames.filter(item => item.id !== id && !own.has(item.name)).map(item => ({ name: item.name, hint: 'Projekt-Asset' }))
  const names = type.inputs.some(port => port.mark)
    ? [...refs.map(ref => ({ name: ref.mark.slice(1), hint: assets[ref.value]?.title, asset: ref.value })),
      ...[...own].map(name => ({ name, hint: refs.filter(ref => ref.name === name).length === 1 ? 'Knoten' : 'alle Dateien des Knotens' })), ...projectAssets]
    : type.runs ? projectAssets
      : node.type === 'text' || node.type === 'scene' ? mentionNames.filter(name => name !== nodeName(node, type)).map(name => ({ name, ...(assetNames.some(item => item.name === name) && { hint: 'Projekt-Asset' }) })) : []
  const status = view?.status === 'running' || view?.status === 'waiting' ? 'loading' : view?.status === 'failed' ? 'error' : 'initial'
  const right = modelName || (node.type === 'text' ? `${(node.prompt ?? '').length} Zeichen` : node.name ? type.title : '')
  const runsAfter = !type.runs && edges.some(edge => edge.source === id)
  return <>
    <div className={cn('relative', type.runs ? 'w-80' : 'w-64')} style={{ minHeight: 28 + tall * 40 }}>
      <NodeHeader node={node} type={type} right={right}/>
      <NodeStatusIndicator status={status}>
        <BaseNode className={cn('flow-node overflow-hidden rounded-xl', node.type === 'text' && 'bg-[var(--c-fill)]')}>
          {type.runs && type.outputs.some(port => port.kind !== 'text') && <Preview type={type} view={view}/>}
          {type.runs && detail !== 'glance' && node.type !== 'director' && node.type !== 'moodboard' && (type.outputs.every(port => port.kind === 'text') || view?.outputs?.text?.length > 0) &&
            <div className="p-3 pb-0"><TextResult view={view}/></div>}
          {detail === 'glance' ? (node.type === 'library' || node.type === 'scene') && <BaseNodeContent><NodeBody node={node} type={type}/></BaseNodeContent> :
          <BaseNodeContent className={cn(type.runs && type.outputs.some(port => port.kind !== 'text') && 'border-t')}>
            <NodeBody node={node} type={type}/>
            {type.fields.filter(field => field.type === 'longtext').map(field => <label key={field.key} className="nodrag [display:grid] gap-1 text-xs text-muted-foreground"><span>{field.label}</span>
              <textarea className="flow-prompt nowheel" rows={field.rows ?? 3} placeholder={field.placeholder} value={node.params?.[field.key] ?? ''}
                onChange={e => update(id, n => ({ ...n, params: { ...n.params, [field.key]: e.target.value } }))}/></label>)}
            {type.prompt && <PromptField node={node} type={type} names={names}/>}
            {node.type === 'director' && <ShotList node={node} view={view}/>}
            {detail === 'full' && <References node={node} view={view}/>}
            {(view?.warnings ?? []).map(text => <p key={text} className="flow-warning" role="status">{text}</p>)}
            {view?.status === 'failed' && view.error && <p className="flow-error" role="alert">{view.error}</p>}
            {view?.status === 'unknown' && <p className="flow-error">{view.error}</p>}
            {(type.runs || runsAfter) && <div className="flex items-center justify-between gap-2">
              <span className={cn('text-xs tabular-nums text-muted-foreground', view?.stale && 'text-[var(--c-port-audio)]')}>{state}{view?.status === 'done' && typeof view.credits === 'number' ? ` · ${view.credits} Credits` : ''}</span>
              {type.runs ? <RunButton node={node} view={view}/> : <Button size="sm" className="nodrag" onClick={() => run(id, 'downstream')}><Play/>Ab hier ausführen</Button>}
            </div>}
          </BaseNodeContent>}
        </BaseNode>
      </NodeStatusIndicator>
      {/* Always open while readable, like ElevenLabs; it lives inside the node so it zooms with it. Rare actions sit in ⋯. */}
      {detail === 'full' && <div className="nodrag absolute left-1/2 top-full mt-2 flex w-max -translate-x-1/2 items-center gap-0.5 rounded-full border bg-popover p-1 shadow-[var(--shadow-subtle)]" role="toolbar" aria-label={nodeName(node, type) + ': Einstellungen'}>
        <NodeTools id={id} node={node} type={type} view={view} model={model} modelField={modelField} quick={quick} more={more} firstMedia={firstMedia}/>
      </div>}
    </div>
    <Ports ports={type.inputs} side="in" connected={inbound} nodeId={id}/>
    <Ports ports={outputs} side="out" connected={outbound} nodeId={id}/>
  </>
}

/** Contents of the node's toolbar: model, the main settings as values, more settings, download, delete and ⋯. */
function NodeTools({ id, node, type, view, model, modelField, quick, more, firstMedia }) {
  const { update, remove, duplicate } = useContext(Actions)
  return <>
      {modelField && <Picker field={modelField} value={String(model)} onChange={value => update(id, n => withField(n, modelField, value))}/>}
      {quick.map(field => <QuickSetting key={(field.model ?? '') + field.key} node={node} field={field}/>)}
      {more.length > 0 && <Popover>
        <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Weitere Einstellungen" title="Weitere Einstellungen"><SlidersHorizontal/></Button></PopoverTrigger>
        <PopoverContent className="[display:grid] w-80 gap-2">{more.map(field => <label key={(field.model ?? '') + field.key} className="[display:grid] min-h-9 grid-cols-[1fr_144px] items-center gap-2 text-sm text-secondary-foreground">
          <span>{field.label}</span>
          {field.type === 'enum'
            ? <select className={selectClass} value={String(fieldValue(node, field))} onChange={e => update(id, n => withField(n, field, e.target.value))}>
              {field.options.map(option => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}</select>
            : <input type="checkbox" className="size-5 justify-self-end accent-[var(--c-ink-2)]" checked={Boolean(fieldValue(node, field))} onChange={e => update(id, n => withField(n, field, e.target.checked))}/>}
        </label>)}</PopoverContent>
      </Popover>}
      {(modelField || quick.length > 0) && <span className="mx-1 h-5 w-px bg-border" aria-hidden="true"/>}
      {firstMedia ? <Button asChild variant="ghost" size="icon-sm" aria-label="Download" title="Download"><a href={mediaUrl(firstMedia)} download><Download/></a></Button>
        : !type.runs && <Button variant="ghost" size="icon-sm" aria-label="Duplizieren" title="Duplizieren" onClick={() => duplicate(id)}><Copy/></Button>}
      <Button variant="ghost" size="icon-sm" aria-label="Knoten löschen" title="Löschen" onClick={() => remove(id)}><Trash2/></Button>
      <NodeMenu node={node} type={type} view={view}/>
  </>
}
/** Room and default sizes of a moodboard and its items, in canvas pixels. */
const board = { width: 720, height: 480, file: 176, note: 192, color: 96 }
const boardSize = node => ({ width: Number(node.params?.width) || board.width, height: Number(node.params?.height) || board.height })

/**
 * One item on a moodboard: a Library file, a note, a keyword or a colour. It moves with the pointer (screen distance
 * divided by the zoom) and is saved when let go; the last moved item lies on top.
 */
function BoardItem({ node, item, onMove, onChange, onRemove, onOpen }) {
  const { ctx, assets } = useContext(Actions)
  const zoom = useViewportStore(store => store.transform[2])
  const [shift, setShift] = useState(null)
  const start = useRef(null)
  const editable = event => event.target.closest('textarea, input, button')
  const width = item.kind === 'file' ? Number(item.w) || board.file : item.kind === 'note' ? board.note : item.kind === 'color' ? board.color : undefined
  return <div className={cn('flow-board-item', 'is-' + item.kind, shift && 'moving')} style={{ left: (item.x ?? 0) + (shift?.x ?? 0), top: (item.y ?? 0) + (shift?.y ?? 0), width }}
    onPointerDown={event => { if (editable(event) || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); start.current = { x: event.clientX, y: event.clientY }; setShift({ x: 0, y: 0 }) }}
    onPointerMove={event => { if (start.current) setShift({ x: (event.clientX - start.current.x) / zoom, y: (event.clientY - start.current.y) / zoom }) }}
    onPointerUp={() => { if (!start.current) return; start.current = null; if (shift && (Math.abs(shift.x) > 2 || Math.abs(shift.y) > 2)) onMove(shift); setShift(null) }}
    onDoubleClick={event => { if (item.kind === 'file' && !editable(event)) onOpen() }}>
    {item.kind === 'file' && (assets[item.assetId] ? <Media asset={assets[item.assetId]} ctx={ctx}/> : <span className="flow-board-gone">Datei fehlt in der Library</span>)}
    {item.kind === 'note' && <textarea className="nowheel" rows={4} aria-label="Notiz" placeholder="Notiz" value={item.text ?? ''} onChange={e => onChange({ text: e.target.value.slice(0, 2000) })}/>}
    {item.kind === 'word' && <input aria-label="Stichwort" placeholder="Stichwort" size={Math.max(6, (item.text ?? '').length + 1)} maxLength={40} value={item.text ?? ''} onChange={e => onChange({ text: e.target.value })}/>}
    {item.kind === 'color' && <>
      <span className="flow-board-swatch" style={{ backgroundColor: item.color }}/>
      <label className="flow-board-hex"><span className="tabular-nums">{String(item.color).toUpperCase()}</span>
        <input type="color" aria-label="Farbton ändern" value={item.color} onChange={e => onChange({ color: e.target.value })}/></label>
    </>}
    <Button variant="secondary" size="icon-xs" className="flow-board-remove" aria-label="Vom Moodboard nehmen" title="Vom Moodboard nehmen" onClick={onRemove}><X/></Button>
  </div>
}

/** The structured look of a moodboard after „Look erzeugen“: overall look, light, camera, palette, materials, key images. */
function LookCard({ view }) {
  const { ctx, assets, openViewer } = useContext(Actions)
  const dna = view?.data
  if (!dna?.look) return null
  const keys = (view.outputs?.keys ?? []).filter(id => assets[id])
  const rows = [['Licht', dna.light], ['Kamera', dna.camera], ['Palette', dna.palette], ['Material', dna.materials]].filter(([, value]) => value)
  const hexes = String(dna.palette ?? '').match(/#[0-9a-f]{6}/gi) ?? []
  return <div className={cn('flow-look', view.stale && 'stale')}>
    <p className="flow-look-lead">{dna.look}</p>
    <dl>{rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}
      {label === 'Palette' && hexes.length > 0 && <span className="flow-look-chips">{hexes.map(hex => <span key={hex} style={{ backgroundColor: hex }} title={hex}/>)}</span>}</dd></React.Fragment>)}</dl>
    {keys.length > 0 && <div className="flow-look-keys" aria-label="Leitbilder">{keys.map((id, i) => <button key={id} type="button" className="nodrag" aria-label={`Leitbild ${i + 1} ansehen`} onClick={() => openViewer({ ids: keys, index: i })}><Media asset={assets[id]} ctx={ctx}/></button>)}</div>}
  </div>
}

/**
 * The moodboard node: a free pinboard without lines inside (Milanote, PureRef). Pictures, notes, keywords and colours
 * lie where they are put; dropping or pasting files adds them where they land. Below it the bar adds items, and
 * „Look erzeugen“ condenses the board into the structured look shown under it.
 */
function BoardNode({ id, data, selected }) {
  const { update, edges, pickAssets, uploadAssets, openViewer } = useContext(Actions)
  const { node, type, view } = data
  const { width, height } = boardSize(node)
  const items = node.params?.items ?? []
  const setItems = fn => update(id, n => ({ ...n, params: { ...n.params, items: fn(n.params?.items ?? []) } }))
  // New notes, keywords and colours land in the top left corner, a little apart from each other, on top of the rest.
  const free = () => { const n = items.filter(item => item.kind !== 'file').length % 6; return { x: 24 + n * 24, y: 24 + n * 24 } }
  const add = fields => setItems(list => [...list, { id: crypto.randomUUID(), ...free(), ...fields }])
  const files = items.filter(item => item.kind === 'file').map(item => item.assetId)
  const model = modelOf(node, type)
  const modelField = type.fields.find(field => field.key === 'modelId')
  const outbound = new Set(edges.filter(edge => edge.source === id).map(edge => edge.sourceHandle))
  const status = view?.status === 'running' || view?.status === 'waiting' ? 'loading' : view?.status === 'failed' ? 'error' : 'initial'
  const facts = [items.length === 1 ? '1 Element' : `${items.length} Elemente`, view?.stale ? 'Look veraltet' : view?.status === 'done' ? 'Look fertig' : ''].filter(Boolean).join(' · ')
  return <>
    <div className="relative" style={{ width }}>
      <NodeResizer isVisible={selected} minWidth={400} minHeight={280} lineClassName="flow-resize-line" handleClassName="flow-resize-handle"
        onResizeEnd={(_, size) => update(id, n => ({ ...n, params: { ...n.params, width: Math.round(size.width / 8) * 8, height: Math.max(280, Math.round((size.height - 200) / 8) * 8) } }))}/>
      <NodeHeader node={node} type={type} right={facts}/>
      <NodeStatusIndicator status={status}>
        <BaseNode className="flow-node overflow-hidden rounded-xl">
          <div className="flow-board nodrag nowheel" style={{ height }} aria-label="Moodboard-Fläche"
            data-board={id}>
            {!items.length && <p className="flow-board-empty">Zieh Bilder vom Mac hierher, füge sie mit ⌘V ein oder nutze die Leiste unten. Alles darf frei liegen, ohne Linien.</p>}
            {items.map(item => <BoardItem key={item.id} node={node} item={item}
              onMove={delta => setItems(list => [...list.filter(other => other.id !== item.id), { ...item, x: Math.round(Math.max(0, Math.min(width - 48, (item.x ?? 0) + delta.x))), y: Math.round(Math.max(0, Math.min(height - 32, (item.y ?? 0) + delta.y))) }])}
              onChange={fields => setItems(list => list.map(other => (other.id === item.id ? { ...other, ...fields } : other)))}
              onRemove={() => setItems(list => list.filter(other => other.id !== item.id))}
              onOpen={() => openViewer({ ids: files, index: files.indexOf(item.assetId) })}/>)}
          </div>
          <div className="nodrag flex flex-wrap items-center gap-1 border-t px-3 py-2" role="toolbar" aria-label="Zum Moodboard hinzufügen">
            <Button variant="ghost" size="sm" onClick={() => pickAssets(node)}><Archive/>Aus der Library</Button>
            <Button variant="ghost" size="sm" onClick={() => uploadAssets(node)}><Upload/>Hochladen</Button>
            <Button variant="ghost" size="sm" onClick={() => add({ kind: 'note', text: '' })}><Type/>Notiz</Button>
            <Button variant="ghost" size="sm" onClick={() => add({ kind: 'word', text: '' })}><AtSign/>Stichwort</Button>
            <Button variant="ghost" size="sm" onClick={() => add({ kind: 'color', color: '#8A6A4F' })}><Palette/>Farbe</Button>
          </div>
          <BaseNodeContent className="border-t">
            <LookCard view={view}/>
            {!view?.data?.look && view?.status !== 'running' && <p className="text-sm text-muted-foreground">„Look erzeugen“ liest alles auf dem Board und macht daraus einen Look mit Licht, Kamera, Palette, Material und zwei bis drei Leitbildern. Als Projekt-Asset wirkt er mit @{nodeName(node, type)} in jedem Prompt.</p>}
            {(view?.warnings ?? []).map(text => <p key={text} className="flow-warning" role="status">{text}</p>)}
            {view?.status === 'failed' && view.error && <p className="flow-error" role="alert">{view.error}</p>}
            <div className="flex items-center justify-between gap-2">
              <span className={cn('text-xs tabular-nums text-muted-foreground', view?.stale && 'text-[var(--c-port-audio)]')}>{view?.stale ? 'Board geändert, Look veraltet' : statusNames[view?.status] ?? ''}</span>
              <RunButton node={node} view={view} first="Look erzeugen" again="Look neu erzeugen"/>
            </div>
          </BaseNodeContent>
        </BaseNode>
      </NodeStatusIndicator>
      <div className="nodrag absolute left-1/2 top-full mt-2 flex w-max -translate-x-1/2 items-center gap-0.5 rounded-full border bg-popover p-1 shadow-[var(--shadow-subtle)]" role="toolbar" aria-label={nodeName(node, type) + ': Einstellungen'}>
        <NodeTools id={id} node={node} type={type} view={view} model={model} modelField={modelField} quick={[]} more={[]} firstMedia={null}/>
      </div>
    </div>
    <Ports ports={type.outputs} side="out" connected={outbound} nodeId={id}/>
  </>
}

const nodeTypes = { flow: FlowNode, frame: FrameNode, board: BoardNode }

/** Node menu: shadcn Command (search and keyboard) with the node types that fit, grouped; optional file actions first. */
function AddMenu({ types, at, filter, onPick, onClose, onUpload, onLibrary }) {
  const list = types.filter(type => !filter || (filter.side === 'source' ? type.inputs : type.outputs).some(port => port.kind === filter.kind))
  return <div className="flow-add absolute z-20 w-[336px] overflow-hidden rounded-lg border bg-popover shadow-lg" role="dialog" aria-label="Knoten hinzufügen"
    style={at.screen ? { left: at.screen.x, top: at.screen.y } : undefined} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
    <Command filter={contains}>
      <CommandInput autoFocus placeholder={filter ? `Knoten für ${kindNames[filter.kind]} suchen` : 'Knoten suchen'}/>
      <CommandList className="max-h-[400px]">
        <CommandEmpty>Keine Knotenart passt.</CommandEmpty>
        {onUpload && <CommandGroup heading="Datei">
          <CommandItem value="Hochladen Datei vom Mac" onSelect={onUpload}><Upload/><span className="[display:grid]"><b className="font-medium">Hochladen</b><span className="text-xs text-muted-foreground">Vom Mac in die Sammlung, dann hier verbunden.</span></span></CommandItem>
          <CommandItem value="Aus Sammlung und Library wählen" onSelect={onLibrary}><Archive/><span className="[display:grid]"><b className="font-medium">Aus Sammlung und Library</b><span className="text-xs text-muted-foreground">Vorhandene Dateien wählen.</span></span></CommandItem>
        </CommandGroup>}
        {groups.map(([group, title]) => {
          const items = list.filter(type => type.group === group)
          return items.length > 0 && <CommandGroup key={group} heading={title}>
            {items.map(type => <CommandItem key={type.type} value={type.title + ' ' + type.description} onSelect={() => onPick(type)} className="items-start">
              <Icon name={type.icon} className="mt-0.5 size-4"/><span className="[display:grid] gap-0.5"><b className="font-medium">{type.title}{type.paid ? ' · kostet Credits' : ''}</b>
                <span className="text-xs text-muted-foreground">{type.description}</span></span></CommandItem>)}
          </CommandGroup>
        })}
      </CommandList>
    </Command>
    <Button variant="ghost" size="icon-sm" className="absolute right-1 top-1.5" aria-label="Schließen" onClick={onClose}><Plus className="rotate-45"/></Button>
  </div>
}

function AssetPicker({ ctx, initial, single, onDone, onClose }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState(initial)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => ctx.api('/search?' + new URLSearchParams({ q: query, limit: 60 }))
      .then(result => { if (active) { setItems(result.items.filter(item => /^(image|video|audio)\//.test(item.media_type ?? '') || item.preview)); setError('') } })
      .catch(e => { if (active) setError(e.message) }), 250)
    return () => { active = false; clearTimeout(timer) }
  }, [query, attempt])
  const toggle = id => setChosen(chosen.includes(id) ? chosen.filter(x => x !== id) : single ? [id] : [...chosen, id].slice(0, 24))
  const title = single ? 'Startbild wählen' : 'Dateien wählen'
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flow-dialog max-w-[720px]">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Aus Sammlung und Library, zuerst die passendsten Treffer.</DialogDescription></DialogHeader>
      <input className="text-in" autoFocus placeholder="In Sammlung und Library suchen" value={query} onChange={e => setQuery(e.target.value)}/>
      {error ? <p className="flow-error" role="alert">{error} <Button variant="outline" size="sm" onClick={() => setAttempt(attempt + 1)}>Erneut versuchen</Button></p>
        : !items ? <div className="[display:grid] grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2" aria-label="Lädt">{Array.from({ length: 8 }, (_, i) => <span key={i} className="h-36 rounded-md bg-card"/>)}</div>
          : !items.length ? <p className="text-sm text-muted-foreground">{query.trim() ? 'Nichts gefunden. Versuch ein anderes Wort.' : 'Die Library ist noch leer. Lade Dateien über „Hochladen“ hoch.'}</p>
            : <div className="[display:grid] max-h-[50vh] grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 overflow-auto">{items.map(item =>
              <button key={item.id} className={cn('flow-pick [display:grid] gap-1 overflow-hidden rounded-md border-2 border-transparent bg-card text-left text-xs text-secondary-foreground active:scale-[.98]', chosen.includes(item.id) && 'border-[var(--c-focus)]')}
                aria-pressed={chosen.includes(item.id)} onClick={() => toggle(item.id)}><Media asset={item} ctx={ctx}/><span className="truncate px-2 pb-2">{item.title}</span></button>)}</div>}
      <DialogFooter className="items-center"><span className="mr-auto text-sm text-muted-foreground">{chosen.length} gewählt</span>
        <Button variant="outline" onClick={onClose}>Abbrechen</Button><Button onClick={() => onDone(chosen)}>Übernehmen</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function Templates({ list, onPick, onClose, busy }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flow-dialog max-w-[720px]">
      <DialogHeader><DialogTitle>Vorlage einfügen</DialogTitle>
        <DialogDescription>Die Vorlage kommt rechts neben das, was schon auf der Fläche liegt. Datei-Knoten füllt sie mit passenden Bildern aus deiner Sammlung, zuerst aus diesem Projekt. Ausgeführt wird nichts.</DialogDescription></DialogHeader>
      <div className="[display:grid] grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">{list.map((item, i) =>
        <button key={item.id} autoFocus={i === 0} disabled={busy} onClick={() => onPick(item)}
          className="[display:grid] content-start gap-1 rounded-md border bg-card p-3 text-left text-sm text-secondary-foreground hover:bg-secondary active:bg-accent disabled:opacity-50">
          <b className="text-lg text-foreground">{item.title}</b><span>{item.description}</span>{item.phases > 0 && <small className="text-muted-foreground">{item.phases === 1 ? '1 Rahmen' : `${item.phases} Rahmen`}</small>}</button>)}</div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Abbrechen</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function Confirm({ steps, onYes, onNo }) {
  const paid = steps.filter(step => step.paid)
  return <Dialog open onOpenChange={open => { if (!open) onNo() }}>
    <DialogContent className="flow-dialog max-w-[440px]">
      <DialogHeader><DialogTitle>{steps.length} Knoten ausführen?</DialogTitle>
        <DialogDescription>{paid.length} davon rufen einen Anbieter auf und kosten Credits.</DialogDescription></DialogHeader>
      <ol className="max-h-72 list-decimal overflow-auto pl-8 text-sm">{steps.map(step => <li key={step.id}>{step.name && step.name !== step.title ? `${step.name} (${step.title})` : step.title}{step.paid ? ' · kostet Credits' : ''}</li>)}</ol>
      <DialogFooter><Button variant="outline" autoFocus onClick={onNo}>Abbrechen</Button><Button onClick={onYes}>Alle ausführen</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

const shotStates = {
  draft: 'Entwurf', keyframe: 'Keyframe ok', video: 'Video ok', stale: 'Veraltet', running: 'Läuft', failed: 'Fehler',
}

/**
 * Film strip (the pipeline view): every scene of the storyboard as a card in shot order, with its keyframe, its clip
 * and a status. Cards can be chosen and rendered together, reordered by dragging and given their missing steps.
 * `shots` comes from `filmOf()`; nothing here runs without a click.
 */
function Filmstrip({ shots, film, onRun, onCreate, onReorder, onFocus, onClose }) {
  const { ctx, assets } = useContext(Actions)
  const [chosen, setChosen] = useState(new Set())
  const [dragged, setDragged] = useState(null)
  const ids = shots.map(shot => shot.scene.id)
  useEffect(() => setChosen(current => new Set([...current].filter(id => ids.includes(id)))), [ids.join()])
  const picked = shots.filter(shot => chosen.has(shot.scene.id))
  const scope = picked.length ? picked : shots
  const keyframes = scope.map(shot => shot.keyframe?.id).filter(Boolean)
  const videos = scope.map(shot => shot.video?.id).filter(Boolean)
  const missing = scope.filter(shot => !shot.video).map(shot => shot.scene.id)
  const toggle = id => setChosen(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const which = picked.length ? ` (${picked.length})` : ' (alle)'
  return <section className="flow-strip nodrag nowheel" aria-label="Filmstreifen">
    <header className="flow-strip-head">
      <strong>Filmstreifen</strong>
      <span className="text-sm text-muted-foreground tabular-nums">{shots.length === 1 ? '1 Einstellung' : `${shots.length} Einstellungen`} · {shots.reduce((sum, shot) => sum + shot.duration, 0)} s</span>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {shots.length > 0 && <Button variant="ghost" size="sm" onClick={() => setChosen(picked.length === shots.length ? new Set() : new Set(ids))}>{picked.length === shots.length ? 'Keine wählen' : 'Alle wählen'}</Button>}
        {missing.length > 0 && <Button variant="outline" size="sm" onClick={() => onCreate(missing)}><Plus/>Schritte anlegen{picked.length ? ` (${missing.length})` : ''}</Button>}
        <Button variant="outline" size="sm" disabled={!keyframes.length} onClick={() => onRun(keyframes, 'node')}><Image/>Keyframes rendern{which}</Button>
        <Button variant="outline" size="sm" disabled={!videos.length} onClick={() => onRun(videos, 'upstream')}><Video/>Videos rendern{which}</Button>
        <Button variant="ghost" size="icon-sm" aria-label="Filmstreifen schließen" title="Schließen" onClick={onClose}><X/></Button>
      </div>
    </header>
    {!shots.length
      ? <p className="flow-strip-empty">Noch keine Szenen. Führe die Regie aus und klicke „Szenen anlegen“, oder lege Szene-Knoten im Storyboard an.</p>
      : <ol className="flow-strip-cards">
        {shots.map((shot, i) => {
          const thumb = shot.thumb && assets[shot.thumb]
          return <li key={shot.scene.id} className={cn('flow-card', chosen.has(shot.scene.id) && 'chosen', dragged === shot.scene.id && 'dragging')}
            draggable onDragStart={event => { setDragged(shot.scene.id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragged(null)}
            onDragOver={event => { if (dragged) event.preventDefault() }}
            onDrop={event => { event.preventDefault(); if (dragged && dragged !== shot.scene.id) onReorder(dragged, shot.scene.id); setDragged(null) }}>
            <div className="flow-card-media" onDoubleClick={() => onFocus(shot.scene.id)}>
              {thumb ? <Media asset={thumb} ctx={ctx}/> : <span className="flow-card-blank"><Icon name="shot" className="size-5"/></span>}
              <label className="flow-card-pick" title="Für Sammelaktionen wählen"><input type="checkbox" checked={chosen.has(shot.scene.id)} onChange={() => toggle(shot.scene.id)} aria-label={`Einstellung ${i + 1} wählen`}/></label>
              <span className={cn('flow-card-state', 'is-' + shot.status)}>{shotStates[shot.status]}</span>
            </div>
            <div className="flow-card-body">
              <button type="button" className="flow-card-title" onClick={() => onFocus(shot.scene.id)} title="Auf der Fläche zeigen">
                <b>{i + 1} · {shot.title}</b><span className="tabular-nums">{shot.duration} s</span></button>
              <p className="flow-card-text">{shot.prompt || 'Noch ohne Beschreibung.'}</p>
              {shot.mentions.length > 0 && <p className="flow-card-assets">{shot.mentions.map(name => '@' + name).join(' ')}</p>}
              <div className="flex gap-1">
                {shot.video
                  ? <>{shot.keyframe && <Button variant="outline" size="sm" onClick={() => onRun([shot.keyframe.id], 'node')}><Image/>Keyframe</Button>}
                    <Button variant="outline" size="sm" onClick={() => onRun([shot.video.id], 'upstream')}><Video/>Video</Button></>
                  : <Button variant="outline" size="sm" onClick={() => onCreate([shot.scene.id])}><Plus/>Schritte anlegen</Button>}
              </div>
            </div>
          </li>
        })}
        {film && <li className="flow-card flow-card-film">
          <div className="flow-card-media">{film.thumb && assets[film.thumb] ? <Media asset={assets[film.thumb]} ctx={ctx}/> : <span className="flow-card-blank"><Icon name="composition" className="size-5"/></span>}
            <span className={cn('flow-card-state', 'is-' + film.status)}>{shotStates[film.status]}</span></div>
          <div className="flow-card-body">
            <button type="button" className="flow-card-title" onClick={() => onFocus(film.node.id)}><b>Film</b><span className="tabular-nums">{film.clips} Clips</span></button>
            <p className="flow-card-text">Setzt die Clips in dieser Reihenfolge zusammen. Fehlende Videos rendert der Schnitt vorher, nach Rückfrage.</p>
            <Button variant="outline" size="sm" className="self-start" onClick={() => onRun([film.node.id], 'upstream')}><Scissors/>Film schneiden</Button>
          </div>
        </li>}
      </ol>}
  </section>
}

/** Room around fitted content: the floating bar sits on top, the dock and zoom bar at the bottom. */
const fitPadding = { top: '80px', right: '48px', bottom: '96px', left: '48px' }

/** Zoom controls in the product's language and button size, with the current zoom and the optional overview map. */
function ZoomBar({ overview, setOverview }) {
  const flow = useReactFlow()
  const zoom = useViewportStore(store => store.transform[2])
  return <Panel position="bottom-right" className="flex items-center gap-0.5 rounded-full border bg-popover p-1 shadow-[var(--shadow-subtle)]" role="toolbar" aria-label="Ansicht">
    <Button variant="ghost" size="icon" aria-label="Verkleinern" title="Verkleinern" onClick={() => flow.zoomOut({ duration: 0 })}><Minus/></Button>
    <span className="w-12 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">{Math.round(zoom * 100)} %</span>
    <Button variant="ghost" size="icon" aria-label="Vergrößern" title="Vergrößern" onClick={() => flow.zoomIn({ duration: 0 })}><Plus/></Button>
    <Button variant="ghost" size="icon" aria-label="Alles zeigen" title="Alles zeigen" onClick={() => flow.fitView({ padding: fitPadding, duration: 0 })}><Maximize/></Button>
    <Button variant={overview ? 'secondary' : 'ghost'} size="icon" aria-pressed={overview} aria-label="Übersichtskarte" title="Übersichtskarte" onClick={() => setOverview(!overview)}><MapIcon/></Button>
  </Panel>
}

function Canvas({ ctx, project, record, types, boards, templates, step = null, page = 'flows' }) {
  const flow = useReactFlow()
  const typeOf = useMemo(() => new Map(types.map(type => [type.type, type])), [types])
  const isFrame = node => Boolean(typeOf.get(node.type)?.contains)
  const settle = doc => adoptIntoFrames(doc, isFrame).doc
  const initial = useMemo(() => adoptIntoFrames({ nodes: [], edges: [], ...record.data }, isFrame), [])
  const [doc, setDoc] = useState(initial.doc)
  const [view, setView] = useState({ nodes: {}, assets: {} })
  // On a step page only the phase frame, its content and the free nodes are shown; other phases are hidden, not removed.
  const stepFrame = step ? doc.nodes.find(node => isFrame(node) && phaseOf(node) === step) ?? null : null
  const hidden = new Set(step ? doc.nodes.filter(node => (isFrame(node) && node !== stepFrame) || (node.parentId && node.parentId !== stepFrame?.id)).map(node => node.id) : [])
  const [strip, setStrip] = useState(step === 'storyboard')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(null)
  const [picker, setPicker] = useState(null)
  const [viewer, setViewer] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [hand, setHand] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [overview, setOverview] = useState(false)
  // Fit once React Flow has measured the nodes; the initial fit runs before the cards have their real size.
  const fitted = useRef(false)
  // React Flow's own colours (controls, minimap) follow the hub theme switch.
  const [colorMode, setColorMode] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const follow = () => setColorMode(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    addEventListener('atelier-theme', follow)
    return () => removeEventListener('atelier-theme', follow)
  }, [])
  // React Flow's own per-node state (measured size, selection, dragging, live resize), kept by its changesets.
  const [meta, setMeta] = useState({})
  const latestMeta = useRef(meta)
  const glance = useViewportStore(store => store.transform[2] < 0.35)
  const measuredCount = Object.values(meta).filter(item => item.measured).length
  const state = useRef({ data: initial.doc, saved: initial.changed ? null : initial.doc, revision: record.revision, timer: null, saving: null }).current
  const shell = useRef(null)
  const pointer = useRef(null)

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
  /** Applies a change to the flow and saves it shortly after; `regroup` re-checks which frame each node belongs to. */
  function change(update, regroup = false) {
    const next = { ...state.data, ...update(state.data) }
    state.data = regroup ? settle(next) : next
    setDoc(state.data)
    setStatus('Speichert …')
    clearTimeout(state.timer)
    state.timer = setTimeout(() => flush().catch(report), 400)
  }
  function report(e) { setError(e.message); setStatus('Speichern prüfen') }
  useEffect(() => { if (initial.changed) flush().catch(report); else refresh() }, [])
  useEffect(() => () => { if (state.saved !== state.data) flush().catch(e => ctx.toast(e.message, true)) }, [])
  useEffect(() => {
    if (fitted.current || !doc.nodes.length || measuredCount < doc.nodes.filter(item => !hidden.has(item.id) && !(glance && item.parentId)).length) return
    fitted.current = true
    // A step page shows its frame together with the nodes the frame feeds directly (the Style-DNA beside the moodboard).
    if (stepFrame) flow.fitView({ nodes: [stepFrame.id, ...doc.edges.filter(edge => edge.source === stepFrame.id).map(edge => edge.target)].map(id => ({ id })), padding: fitPadding, duration: 0 })
    else flow.fitView({ padding: fitPadding, duration: 0 })
  }, [measuredCount])
  const busy = Object.values(view.nodes).some(item => item.status === 'running' || item.status === 'waiting')
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [busy])

  const byId = new Map(doc.nodes.map(node => [node.id, node]))
  const update = (id, fn, regroup = false) => change(d => ({ nodes: d.nodes.map(node => node.id === id ? fn(node) : node) }), regroup)
  // Removing a frame keeps its content: the children return to canvas positions.
  const remove = id => change(d => {
    const map = new Map(d.nodes.map(node => [node.id, node]))
    const nodes = d.nodes.filter(node => node.id !== id).map(node => {
      if (node.parentId !== id) return node
      const { parentId, ...rest } = node
      return { ...rest, ...absolute(node, map) }
    })
    return { nodes, edges: d.edges.filter(edge => edge.source !== id && edge.target !== id) }
  })
  const duplicate = id => {
    const node = state.data.nodes.find(item => item.id === id)
    if (node) change(d => ({ nodes: [...d.nodes, { ...structuredClone(node), id: crypto.randomUUID(), x: node.x + 48, y: node.y + 48 }] }), true)
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
    change(d => ({ nodes: [...d.nodes, node], edges: edge ? connectEdges(d, edge) : d.edges }), true)
    setMenu(null)
    return node
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
  function pickAssets(node, single = false) { setPicker({ id: node.id, single, board: node.type === 'moodboard' }) }
  /**
   * Pins Library files on a moodboard: from `at` (board pixels) in a cascade, otherwise in the next free grid places.
   * The board grows when they would fall below it.
   */
  function addToBoard(nodeId, assetIds, at = null) {
    update(nodeId, n => {
      const items = n.params?.items ?? []
      const fresh = assetIds.filter(assetId => !items.some(item => item.kind === 'file' && item.assetId === assetId)).map((assetId, i) => {
        const k = items.length + i
        const place = at ? { x: Math.max(0, Math.round(at.x + i * 24)), y: Math.max(0, Math.round(at.y + i * 24)) } : { x: 16 + (k % 4) * 184, y: 16 + Math.floor(k / 4) * 256 }
        return { id: crypto.randomUUID(), kind: 'file', assetId, ...place }
      })
      const { height } = boardSize(n)
      const bottom = Math.max(0, ...fresh.map(item => item.y + 248))
      return { ...n, params: { ...n.params, items: [...items, ...fresh], ...(bottom > height && { height: Math.ceil(bottom / 8) * 8 }) } }
    })
  }
  /** Stores files in the project: images and videos through the hub, sound through the Video Playground's upload route. */
  async function storeFiles(files) {
    const list = [...files]
    const visual = list.filter(file => /^(image|video)\//.test(file.type))
    const created = visual.length ? await ctx.uploadFiles(visual, { projectId: project }) : []
    if (!list.some(file => /^(image|video|audio)\//.test(file.type))) ctx.toast('Nur Bilder, Videos und Ton (MP3, WAV) lassen sich ablegen.', true)
    for (const file of list.filter(file => /^audio\//.test(file.type))) {
      try {
        const response = await fetch('/creativity-influencer/api/media?' + new URLSearchParams({ title: file.name.replace(/\.[^.]+$/, '') }), { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
        const asset = await response.json()
        if (!response.ok) throw new Error(asset.error)
        created.push(asset)
      } catch (e) { ctx.toast(`„${file.name}“: ${e.message || 'Hochladen fehlgeschlagen.'}`, true) }
    }
    return created
  }
  function uploadAssets(node) {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'image/*,video/*,audio/mpeg,audio/wav' })
    input.onchange = async () => {
      const created = await storeFiles(input.files)
      if (!created.length) return
      if (node.type === 'moodboard') addToBoard(node.id, created.map(item => item.id))
      else update(node.id, n => ({ ...n, params: { ...n.params, assetIds: [...(n.params?.assetIds ?? []), ...created.map(item => item.id)].slice(0, 24) } }))
    }
    input.click()
  }
  /**
   * Places pasted or dropped files, text and links at a canvas position. All files of one drop go into one Datei node;
   * dropped onto an existing Datei node, they are added to it.
   */
  async function place(position, { files = [], text = '', into = null }) {
    const nodes = []
    const at = i => ({ x: Math.round(position.x + i * 304), y: Math.round(position.y) })
    if (files.length) {
      setStatus('Lädt hoch …')
      const created = await storeFiles(files)
      const ids = created.map(asset => asset.id)
      if (ids.length && into?.board) addToBoard(into.id, ids, into.at)
      else if (ids.length && into) update(into, n => ({ ...n, params: { ...n.params, assetIds: [...new Set([...(n.params?.assetIds ?? []), ...ids])].slice(0, 24) } }))
      else if (ids.length) nodes.push({ id: crypto.randomUUID(), type: 'library', ...at(0), prompt: '', params: { assetIds: ids.slice(0, 24) } })
      if (!created.length) setStatus('')
    }
    const value = text.trim()
    if (value) nodes.push(/^https?:\/\/\S+$/i.test(value)
      ? { id: crypto.randomUUID(), type: 'link', ...at(nodes.length), prompt: '', params: { url: value } }
      : { id: crypto.randomUUID(), type: 'text', ...at(nodes.length), prompt: value.slice(0, 8000), params: {} })
    if (nodes.length) change(d => ({ nodes: [...d.nodes, ...nodes] }), true)
  }
  useEffect(() => {
    // Paste lands where the pointer is, or in the middle of the canvas; inside a text field it stays a normal paste.
    const onPaste = event => {
      if (event.target.closest?.('input, textarea, select, [contenteditable]') || !shell.current?.isConnected) return
      const files = [...(event.clipboardData?.files ?? [])]
      const text = files.length ? '' : event.clipboardData?.getData('text/plain') ?? ''
      if (text.startsWith(clipMark)) { event.preventDefault(); insertCopied(text); return }
      if (!files.length && !text.trim()) return
      event.preventDefault()
      const box = shell.current.getBoundingClientRect()
      // With one moodboard selected, pasted pictures are pinned on it.
      const chosen = selectedIds()
      const boardId = chosen.length === 1 && state.data.nodes.find(node => node.id === chosen[0])?.type === 'moodboard' ? chosen[0] : null
      place(flow.screenToFlowPosition(pointer.current ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 }), { files, text: boardId ? '' : text, into: boardId && files.length ? { id: boardId, board: true } : null }).catch(report)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
  async function insertTemplate(template) {
    setInserting(true)
    try {
      await flush()
      const result = await flowsApi('/projects/' + project + '/templates', 'POST', { templateId: template.id, revision: state.revision })
      state.revision = result.record.revision
      state.data = state.saved = { nodes: [], edges: [], ...result.record.data }
      setDoc(state.data)
      setShowTemplates(false)
      await refresh()
      if (result.skipped.length) ctx.toast(`Nicht geladene Knotenarten fehlen in der Vorlage: ${result.skipped.join(', ')}.`, true)
      const fresh = new Set(result.record.data.nodes.map(node => node.id))
      setTimeout(() => flow.fitView({ nodes: [...fresh].slice(-result.added).map(id => ({ id })), padding: 0.1, duration: 0 }), 80)
    } catch (e) { setError(e.message) } finally { setInserting(false) }
  }
  async function importBoards() {
    try {
      const result = await flowsApi('/projects/' + project + '/import-boards', 'POST', {})
      state.revision = result.revision
      state.data = state.saved = { nodes: [], edges: [], ...result.data }
      setDoc(state.data)
      await refresh()
      setTimeout(() => flow.fitView({ padding: 0.2, duration: 0 }), 50)
    } catch (e) { setError(e.message) }
  }
  /** Shows one frame (a phase of the production) filling the canvas. */
  function focusFrame(node) {
    // The floating bar covers the top 64 px; the frame title must stay visible below it.
    flow.fitBounds({ x: node.x, y: node.y, width: node.params?.width ?? 640, height: node.params?.height ?? 480 }, { padding: fitPadding, duration: 0 })
  }
  /** Opens the node menu at a screen point; new nodes go to the matching point on the canvas. */
  function openMenu(point, filter, position = flow.screenToFlowPosition(point)) {
    const box = shell.current.getBoundingClientRect()
    setMenu({ position, filter, screen: { x: Math.max(16, Math.min(point.x - box.left, box.width - 352)), y: Math.max(64, Math.min(point.y - box.top, box.height - 456)) } })
  }
  const pointOf = event => 'changedTouches' in event ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY } : { x: event.clientX, y: event.clientY }
  function openCentered() {
    const box = shell.current.getBoundingClientRect()
    openMenu({ x: box.left + box.width / 2 - 168, y: box.top + box.height / 2 - 200 }, null)
  }
  /** Opens the node menu for a clicked port; the new node goes beside the port's node and is connected to it. */
  function portMenu(event, port) {
    event.stopPropagation()
    const node = state.data.nodes.find(item => item.id === port.nodeId)
    if (!node) return
    const at = absolute(node, new Map(state.data.nodes.map(item => [item.id, item])))
    const rect = event.currentTarget.getBoundingClientRect()
    openMenu({ x: rect.right + 8, y: rect.top }, port, port.side === 'target' ? { x: at.x - 384, y: at.y } : { x: at.x + 416, y: at.y })
  }

  const running = id => ['running', 'waiting'].includes(view.nodes[id]?.status)
  // While a node runs, the lines into it animate (React Flow's animated edges).
  const byNode = new Map(doc.nodes.map(node => [node.id, node]))
  // Mentioned project assets reach their nodes without a line. A dashed line shows that link, but only while the asset
  // or the node that mentions it is selected, so the canvas stays free of lines across the phases.
  const implied = implicitEdges(doc, name => typeOf.get(name)).flatMap(edge => {
    if (!meta[edge.source]?.selected && !meta[edge.target]?.selected) return []
    const outputs = view.nodes[edge.source]?.outputs
    if (outputs ? !outputs[edge.sourceHandle]?.length : !typeOf.get(byNode.get(edge.source)?.type)?.runs) return []
    const handle = edge.targetHandle === textHandle ? typeOf.get(byNode.get(edge.target)?.type)?.inputs.find(port => port.kind === 'text')?.id : edge.targetHandle
    return handle ? [{ ...edge, targetHandle: handle, selectable: false, deletable: false, focusable: false }] : []
  })
  const edges = [...doc.edges, ...implied].filter(edge => !hidden.has(edge.source) && !hidden.has(edge.target)).map(edge => ({ ...edge, zIndex: 1, animated: running(edge.target),
    className: 'flow-edge kind-' + (portKind(edge.source, edge.sourceHandle, 'source') ?? 'text') + (edge.implicit ? ' implicit' : '') }))
  /** What a frame shows as a poster in the overview: pictures (results before references) and how much is inside. */
  function storyOf(frame) {
    const kids = doc.nodes.filter(item => item.parentId === frame.id).sort((a, b) => (a.y - b.y) || (a.x - b.x))
    const made = [], refs = []
    for (const kid of kids) {
      const kind = typeOf.get(kid.type)
      const outputs = view.nodes[kid.id]?.outputs
      if (!kind || !outputs) continue
      const media = kind.outputs.filter(port => port.kind === 'image' || port.kind === 'video').flatMap(port => outputs[port.id] ?? []).filter(item => view.assets[item])
      ;(kind.runs ? made : refs).push(...media)
    }
    return { cover: [...new Set([...made, ...refs])].slice(0, 4), made: made.length, nodes: kids.length }
  }
  const nodes = doc.nodes.filter(node => !hidden.has(node.id)).map(node => {
    const frame = isFrame(node)
    const own = meta[node.id] ?? {}
    return {
      id: node.id, type: frame ? 'frame' : node.type === 'moodboard' ? 'board' : 'flow', position: { x: node.x, y: node.y }, ...(node.parentId && { parentId: node.parentId }),
      // In the storyboard overview the frames show posters; what lies inside (and its lines) steps aside.
      ...(glance && node.parentId && { hidden: true }),
      dragHandle: frame ? '.flow-frame-head' : '.flow-drag', zIndex: 2, selected: own.selected, dragging: own.dragging, measured: own.measured,
      ...(frame && { width: own.width ?? node.params?.width ?? 640, height: own.height ?? node.params?.height ?? 480, zIndex: 0, style: { pointerEvents: 'none' } }),
      data: { node, type: typeOf.get(node.type), view: view.nodes[node.id], ...(frame && glance && { story: storyOf(node) }) },
    }
  })
  const frames = doc.nodes.filter(isFrame).sort((a, b) => (a.x - b.x) || (a.y - b.y))
  const mentionNames = [...new Set(doc.nodes.filter(node => (node.asset || typeOf.get(node.type)?.outputs.some(port => port.kind !== 'text')) && !isFrame(node))
    .map(node => nodeName(node, typeOf.get(node.type))))]
  const sceneCount = id => doc.nodes.filter(node => node.type === 'scene' && node.params?.from === id).length
  /**
   * Turns the shots of a Regie node into Szene nodes, four per row in shot order (reading order is also the order
   * downstream). Scenes made from it before are updated in order and keep their lines, surplus ones go, missing ones are
   * added; the grid starts where the first scene was, or right of the Regie node. A frame around it grows to fit.
   */
  function spawnScenes(id) {
    const director = state.data.nodes.find(node => node.id === id)
    const shots = view.nodes[id]?.data?.shots ?? []
    const sceneType = typeOf.get('scene')
    if (!director || !shots.length || !sceneType) return
    const map = new Map(state.data.nodes.map(node => [node.id, node]))
    const origin = absolute(director, map)
    const options = sceneType.fields.find(field => field.key === 'duration')?.options ?? []
    const nearest = seconds => options.map(Number).reduce((best, value) => (Math.abs(value - seconds) < Math.abs(best - seconds) ? value : best), Number(options[0] ?? seconds))
    const textOf = shot => [shot.shot && shot.shot + ':', shot.prompt, shot.motion && 'Bewegung: ' + shot.motion].filter(Boolean).join(' ')
    const before = state.data.nodes.filter(node => node.type === 'scene' && node.params?.from === id)
      .map(node => ({ node, at: absolute(node, map) })).sort((a, b) => (a.at.y - b.at.y) || (a.at.x - b.at.x)).map(item => item.node)
    const start = before.length ? absolute(before[0], map) : { x: origin.x + 384, y: origin.y }
    const slot = i => ({ x: start.x + (i % 4) * 304, y: start.y + Math.floor(i / 4) * 456 })
    const made = shots.map((shot, i) => {
      const old = before[i]
      const fields = { name: shot.title, prompt: textOf(shot), ...slot(i), params: { ...old?.params, from: id, duration: String(nearest(shot.duration)) } }
      if (!old) return { id: crypto.randomUUID(), type: 'scene', ...fields }
      const { parentId, ...rest } = old
      return { ...rest, ...fields }
    })
    const gone = new Set(before.slice(shots.length).map(node => node.id))
    const kept = new Map(made.filter(node => map.has(node.id)).map(node => [node.id, node]))
    const fresh = made.filter(node => !map.has(node.id))
    change(d => {
      let nodes = d.nodes.filter(node => !gone.has(node.id)).map(node => kept.get(node.id) ?? node).concat(fresh)
      const frame = director.parentId && nodes.find(node => node.id === director.parentId)
      if (frame) {
        nodes = growFrame(nodes, frame.id, Math.max(...made.map(node => node.x)) + 256 + 48 - frame.x, Math.max(...made.map(node => node.y)) + 408 - frame.y, new Set(made.map(node => node.id)))
        // The frame's measured size would otherwise keep it at its old size until the next resize.
        const grown = nodes.find(node => node.id === frame.id).params
        setMeta(m => ({ ...m, [frame.id]: { ...m[frame.id], width: grown.width, height: grown.height } }))
      }
      return { nodes, edges: d.edges.filter(edge => !gone.has(edge.source) && !gone.has(edge.target)) }
    }, true)
    ctx.toast(fresh.length && kept.size ? `${kept.size} Szenen aktualisiert, ${fresh.length} neu.` : fresh.length ? `${fresh.length} Szenen angelegt.` : `${kept.size} Szenen aktualisiert.`)
  }
  const assetNames = doc.nodes.filter(node => node.asset).map(node => ({ id: node.id, name: nodeName(node, typeOf.get(node.type)) }))
  /** Makes a node a project asset or releases it; returns true when the node still needs a name of its own. */
  function toggleAsset(id) {
    const node = state.data.nodes.find(item => item.id === id)
    if (!node) return false
    update(id, n => { const { asset, ...rest } = n; return asset ? rest : { ...rest, asset: true } })
    if (!node.asset) ctx.toast(`@${nodeName(node, typeOf.get(node.type))} wirkt jetzt in jedem Prompt dieses Flows, auch ohne Linie.`)
    return !node.asset && !String(node.name ?? '').trim()
  }
  /** Node clipboard: the chosen nodes and the lines between them, as text with a marker so a normal paste can tell them apart. */
  const clipMark = 'atelier-flow-nodes:'
  const clip = useRef(null)
  function copyNodes(ids) {
    const chosen = state.data.nodes.filter(node => ids.includes(node.id))
    if (!chosen.length) return
    const text = clipMark + JSON.stringify({ nodes: chosen, edges: state.data.edges.filter(edge => ids.includes(edge.source) && ids.includes(edge.target)) })
    clip.current = text
    navigator.clipboard?.writeText(text).catch(() => {})
    ctx.toast(chosen.length === 1 ? 'Knoten kopiert.' : `${chosen.length} Knoten kopiert.`)
  }
  function insertCopied(text, offset = 48) {
    const { nodes: copied, edges: lines } = JSON.parse(text.slice(clipMark.length))
    const ids = new Map(copied.map(node => [node.id, crypto.randomUUID()]))
    const map = new Map(state.data.nodes.map(node => [node.id, node]))
    // Copies land beside the originals, at canvas positions; regrouping puts them into a frame if they lie in one.
    const nodes = copied.map(node => { const at = absolute(node, map); const { parentId, ...rest } = node; return { ...rest, id: ids.get(node.id), x: at.x + offset, y: at.y + offset } })
    const edges = lines.map(edge => ({ ...edge, id: crypto.randomUUID(), source: ids.get(edge.source), target: ids.get(edge.target) }))
    change(d => ({ nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] }), true)
  }
  async function pasteNodes() {
    const text = await navigator.clipboard?.readText().catch(() => null) ?? clip.current
    if (text?.startsWith(clipMark)) insertCopied(text)
    else if (clip.current) insertCopied(clip.current)
    else ctx.toast('Kopiere zuerst einen Knoten.')
  }
  /** Renames a node and carries its `@` mentions along in every prompt and long text of the flow. */
  function rename(id, name) {
    const node = state.data.nodes.find(item => item.id === id)
    if (!node) return
    const before = nodeName(node, typeOf.get(node.type))
    const after = name || typeOf.get(node.type)?.title || before
    const pattern = new RegExp('@' + before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'gu')
    const carry = text => typeof text === 'string' && before !== after ? text.replace(pattern, '@' + after) : text
    change(d => ({ nodes: d.nodes.map(item => ({
      ...item, ...(item.id === id && { name }), prompt: carry(item.prompt),
      ...(item.params?.outfit !== undefined && { params: { ...item.params, outfit: carry(item.params.outfit) } }),
    })) }))
  }
  const focusNode = id => flow.fitView({ nodes: [{ id }], padding: 0.4, maxZoom: 1.2, duration: 0 })
  // Read through a ref: the paste and key listeners are set up once and must see the current selection.
  latestMeta.current = meta
  const selectedIds = () => Object.entries(latestMeta.current).filter(([, value]) => value.selected).map(([id]) => id)
  useEffect(() => {
    // Shortcuts as in ElevenLabs Flows; inside text fields the keys keep their normal meaning.
    const onKey = event => {
      if (!(event.metaKey || event.ctrlKey) || event.target.closest?.('input, textarea, select, [contenteditable]') || !shell.current?.isConnected) return
      const ids = selectedIds()
      const one = ids.length === 1 ? ids[0] : null
      const type = one && typeOf.get(state.data.nodes.find(node => node.id === one)?.type)
      if (event.key === 'Enter' && one && type?.runs) { event.preventDefault(); run(one, 'node') }
      else if (event.key === 'd' && !event.shiftKey && ids.length) { event.preventDefault(); ids.forEach(duplicate) }
      else if (event.key === '.' && one) { event.preventDefault(); focusNode(one) }
      else if (event.key === 'c' && ids.length && !String(window.getSelection())) { event.preventDefault(); copyNodes(ids) }
      else if (event.key.toLowerCase() === 'd' && event.shiftKey && one) {
        const media = type?.outputs.filter(port => port.kind !== 'text').flatMap(port => view.nodes[one]?.outputs?.[port.id] ?? [])[0]
        if (media) { event.preventDefault(); Object.assign(document.createElement('a'), { href: mediaUrl(media), download: '' }).click() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  /**
   * The film as the strip shows it: the scenes of the storyboard (all scenes if there is no storyboard frame) in reading
   * order, each with the video its text feeds, the keyframe before that video and a status; and the first composition.
   */
  function filmOf() {
    const storyFrame = doc.nodes.find(node => isFrame(node) && phaseOf(node) === 'storyboard')
    const all = new Map(doc.nodes.map(node => [node.id, node]))
    const scenes = readingOrderOf(doc.nodes.filter(node => node.type === 'scene' && (!storyFrame || node.parentId === storyFrame.id)), all)
    const runs = node => Boolean(node && typeOf.get(node.type)?.runs)
    const outputsOf = (node, kind) => (node ? typeOf.get(node.type)?.outputs.filter(port => port.kind === kind).flatMap(port => view.nodes[node.id]?.outputs?.[port.id] ?? []) ?? [] : [])
    const shots = scenes.map(scene => {
      const targets = doc.edges.filter(edge => edge.source === scene.id).map(edge => all.get(edge.target)).filter(Boolean)
      const video = targets.find(node => runs(node) && typeOf.get(node.type).outputs.some(port => port.kind === 'video') && node.type !== 'composition') ?? null
      const intoStart = video && doc.edges.find(edge => edge.target === video.id && edge.targetHandle === 'start')
      const keyframe = (intoStart && runs(all.get(intoStart.source)) ? all.get(intoStart.source) : null)
        ?? targets.find(node => runs(node) && typeOf.get(node.type).outputs.every(port => port.kind === 'image')) ?? null
      const states = [keyframe, video].filter(Boolean).map(node => view.nodes[node.id] ?? {})
      const clip = outputsOf(video, 'video')[0], frame = outputsOf(keyframe, 'image')[0], start = scene.params?.assetIds?.[0]
      const status = states.some(item => item.status === 'running' || item.status === 'waiting') ? 'running'
        : states.some(item => item.status === 'failed') ? 'failed'
          : clip ? (view.nodes[video.id]?.stale ? 'stale' : 'video') : frame || start ? 'keyframe' : 'draft'
      return { scene, video, keyframe, status, thumb: clip ?? frame ?? start ?? null, title: nodeName(scene, typeOf.get('scene')),
        duration: Number(scene.params?.duration) || 5, prompt: scene.prompt ?? '', mentions: assetNames.map(item => item.name).filter(name => mentions(scene.prompt, name)) }
    })
    const composition = doc.nodes.find(node => node.type === 'composition')
    const cut = composition && view.nodes[composition.id]
    const film = composition && { node: composition, clips: doc.edges.filter(edge => edge.target === composition.id && edge.targetHandle === 'clips').length,
      thumb: cut?.outputs?.video?.[0] ?? null, status: cut?.status === 'running' || cut?.status === 'waiting' ? 'running' : cut?.status === 'failed' ? 'failed' : cut?.outputs?.video?.length ? (cut.stale ? 'stale' : 'video') : 'draft' }
    return { shots, film }
  }
  /**
   * Gives scenes their missing pipeline steps: a Bild node for the keyframe (unless the scene has its own start image)
   * and a Video node, both fed by the scene text and joined to the composition. They go into the Videos frame, which is
   * created right of everything when there is none, one row per scene.
   */
  function createSteps(sceneIds) {
    const imageType = typeOf.get('image'), videoType = typeOf.get('video')
    if (!videoType) return ctx.toast('Der Video Playground ist nicht geladen, daher gibt es keinen Video-Knoten.', true)
    const all = new Map(state.data.nodes.map(node => [node.id, node]))
    const nodes = [], edges = []
    let frame = state.data.nodes.find(node => isFrame(node) && phaseOf(node) === 'shots')
    if (!frame) {
      const outer = state.data.nodes.filter(node => !node.parentId)
      const right = outer.length ? Math.max(...outer.map(node => node.x + (Number(node.params?.width) || 320))) + 160 : 0
      const top = outer.length ? Math.min(...outer.map(node => node.y)) : 0
      frame = { id: crypto.randomUUID(), type: 'frame', name: 'Videos', x: right, y: top, prompt: '', params: { width: 2 * 352 + 64, height: 880, phase: 'shots' } }
      nodes.push(frame)
    }
    const inside = state.data.nodes.filter(node => node.parentId === frame.id)
    let y = frame.y + (inside.length ? Math.max(...inside.map(node => node.y)) + 760 : 72)
    const modelField = videoType.fields.find(field => field.key === 'modelId')
    const model = modelField ? fieldDefault(modelField) : undefined
    const look = assetNames.some(item => item.name === 'Look') ? ' Look aus @Look.' : ''
    const composition = state.data.nodes.find(node => node.type === 'composition')
    for (const id of sceneIds) {
      const scene = all.get(id)
      if (!scene) continue
      const name = nodeName(scene, typeOf.get('scene'))
      const durationField = videoType.fields.find(field => field.key === 'duration' && (!field.model || field.model === model))
      const seconds = Number(scene.params?.duration) || 5
      const duration = durationField?.options?.map(optionValue).reduce((best, value) => (Math.abs(Number(value) - seconds) < Math.abs(Number(best) - seconds) ? value : best))
      const video = { id: crypto.randomUUID(), type: 'video', name: 'Video ' + name, x: frame.x + 32 + 352, y, prompt: '',
        params: { ...(model && { modelId: model }), ...(duration !== undefined && (durationField.model ? { settings: { [model]: { duration } } } : { duration })) } }
      nodes.push(video)
      edges.push({ id: crypto.randomUUID(), source: id, sourceHandle: 'text', target: video.id, targetHandle: 'prompt' })
      if (scene.params?.assetIds?.length) edges.push({ id: crypto.randomUUID(), source: id, sourceHandle: 'image', target: video.id, targetHandle: 'start' })
      else if (imageType) {
        const keyframe = { id: crypto.randomUUID(), type: 'image', name: 'Keyframe ' + name, x: frame.x + 32, y, prompt: 'Startbild dieser Einstellung als Standbild.' + look, params: {} }
        nodes.push(keyframe)
        edges.push({ id: crypto.randomUUID(), source: id, sourceHandle: 'text', target: keyframe.id, targetHandle: 'prompt' },
          { id: crypto.randomUUID(), source: keyframe.id, sourceHandle: 'image', target: video.id, targetHandle: 'start' })
      }
      if (composition) edges.push({ id: crypto.randomUUID(), source: video.id, sourceHandle: 'video', target: composition.id, targetHandle: 'clips' })
      y += 760
    }
    change(d => ({ nodes: growFrame([...d.nodes, ...nodes], frame.id, 2 * 352 + 64, y - frame.y + 120, new Set(nodes.map(node => node.id))), edges: [...d.edges, ...edges] }), true)
    const grown = state.data.nodes.find(node => node.id === frame.id)?.params
    if (grown) setMeta(m => ({ ...m, [frame.id]: { ...m[frame.id], width: grown.width, height: grown.height } }))
    ctx.toast(sceneIds.length === 1 ? 'Keyframe und Video angelegt.' : `Schritte für ${sceneIds.length} Einstellungen angelegt.`)
  }
  /**
   * Moves one shot before another. Scenes, keyframes and videos swap their canvas places in the same way, so the reading
   * order (and with it the order in the composition) follows the strip.
   */
  function reorder(movedId, beforeId) {
    const { shots } = filmOf()
    const order = shots.map(shot => shot.scene.id)
    const next = order.filter(id => id !== movedId)
    next.splice(next.indexOf(beforeId) + (order.indexOf(movedId) < order.indexOf(beforeId) ? 1 : 0), 0, movedId)
    const all = new Map(state.data.nodes.map(node => [node.id, node]))
    const placed = new Map()
    for (const pick of [shot => shot.scene, shot => shot.keyframe, shot => shot.video]) {
      const slots = shots.map(pick).filter(Boolean).map(node => absolute(node, all))
      next.map(id => pick(shots.find(shot => shot.scene.id === id))).filter(Boolean).forEach((node, i) => placed.set(node.id, slots[i]))
    }
    change(d => ({ nodes: d.nodes.map(node => { if (!placed.has(node.id)) return node; const { parentId, ...rest } = node; return { ...rest, ...placed.get(node.id) } }) }), true)
  }
  const removeAsset = (nodeId, assetId) => update(nodeId, n => ({ ...n, params: { ...n.params, assetIds: (n.params?.assetIds ?? []).filter(id => id !== assetId) } }))
  const actions = { ctx, focusFrame, assets: view.assets, edges: doc.edges, update, remove, duplicate, run, pick, pickAssets, uploadAssets, mentionNames, portMenu,
    renaming, setRenaming, rename, copyNodes, pasteNodes, focusNode, openViewer: setViewer, removeAsset, toggleAsset, assetNames, spawnScenes, sceneCount }

  return <Actions.Provider value={actions}>
    <div className="flow-shell" ref={shell} data-drop-hint="Loslassen legt einen Datei-Knoten an">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.1} maxZoom={2}
        panOnDrag={hand ? true : [1, 2]} selectionOnDrag={!hand} panOnScroll proOptions={{ hideAttribution: true }} colorMode={colorMode}
        deleteKeyCode={viewer || picker ? null : ['Backspace', 'Delete']} isValidConnection={valid} connectOnClick={false}
        // Fixed layers: frames 0, lines 1, nodes 2, so lines never cover a node, also inside frames.
        zIndexMode="manual" elevateEdgesOnSelect={false}
        onNodesChange={changeset => {
          // React Flow 13: the changeset applies itself to the nodes; the result goes back into the flow and the per-node state.
          const next = changeset.applyTo(nodes)
          const moved = next.filter(item => { const node = byId.get(item.id); return node && (item.position.x !== node.x || item.position.y !== node.y) })
          const gone = doc.nodes.filter(node => !hidden.has(node.id) && !next.some(item => item.id === node.id)).map(node => node.id)
          setMeta(Object.fromEntries(next.map(item => [item.id, { selected: item.selected, dragging: item.dragging, measured: item.measured,
            ...(isFrame(byId.get(item.id) ?? {}) && { width: item.width, height: item.height }) }])))
          if (moved.length) change(d => ({ nodes: d.nodes.map(node => { const item = moved.find(m => m.id === node.id); return item ? { ...node, x: Math.round(item.position.x), y: Math.round(item.position.y) } : node }) }))
          for (const id of gone) remove(id)
        }}
        onNodeDragStop={() => change(d => d, true)}
        onEdgesChange={changeset => {
          const next = changeset.applyTo(edges)
          const gone = doc.edges.filter(edge => !next.some(item => item.id === edge.id)).map(edge => edge.id)
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
        onPointerMove={event => { pointer.current = { x: event.clientX, y: event.clientY } }}
        onDragOver={event => { if (event.dataTransfer.types.includes('Files') && !ctx.draggingInside?.()) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={event => {
          // Only files from outside the page (Finder, another app) become nodes; dragging inside the canvas moves, never copies.
          event.preventDefault()
          if (!event.dataTransfer.files.length || ctx.draggingInside?.()) return
          const target = event.target.closest?.('.react-flow__node')?.getAttribute('data-id')
          const surface = event.target.closest?.('[data-board]')?.getBoundingClientRect()
          const zoom = flow.getViewport().zoom
          // Dropped on a moodboard, files are pinned where they land; on a Datei node they join its files.
          const into = surface && target ? { id: target, board: true, at: { x: (event.clientX - surface.left) / zoom - 64, y: (event.clientY - surface.top) / zoom - 64 } }
            : state.data.nodes.find(node => node.id === target && node.type === 'library')?.id ?? null
          place(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), { files: [...event.dataTransfer.files], into }).catch(report)
        }}
        onEdgeDoubleClick={(_, edge) => change(d => ({ edges: d.edges.filter(item => item.id !== edge.id) }))}>
        <Grid/>
        {overview && <MiniMap position="bottom-right" style={{ marginBottom: 72 }} pannable zoomable ariaLabel="Übersicht der Fläche" bgColor="var(--c-panel)" maskColor="var(--c-tint-3)"
          nodeColor={item => (isFrame(byId.get(item.id) ?? {}) ? 'var(--c-fill-2)' : 'var(--c-fill-4)')}/>}
        <ZoomBar overview={overview} setOverview={setOverview}/>
        {/* One opaque floating bar (ElevenLabs layout): project, phases, save state. Nothing translucent over the nodes. */}
        <Panel position="top-left" className="flex max-w-[calc(100%-32px)] flex-wrap items-center gap-1 rounded-full border bg-popover p-1 shadow-[var(--shadow-subtle)]">
          <select className="text-in h-9 w-auto max-w-60 rounded-full border-0 bg-transparent text-base font-medium" aria-label="Projekt" value={project} onChange={async e => { try { await flush(); location.hash = route(e.target.value, page) } catch (err) { report(err) } }}>
            {ctx.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          {step && <><span className="mx-1 h-5 w-px bg-border" aria-hidden="true"/><span className="px-2 text-sm font-medium">{steps[step].title}</span>
            <Button asChild variant="ghost" size="sm"><a href={route(project)} className="no-underline">Ganzer Flow</a></Button></>}
          {!step && <Button variant={strip ? 'secondary' : 'ghost'} size="sm" aria-pressed={strip} onClick={() => setStrip(!strip)}><Clapperboard/>Filmstreifen</Button>}
          {!step && frames.length > 1 && <><span className="mx-1 h-5 w-px bg-border" aria-hidden="true"/><nav className="flex flex-wrap gap-0.5" aria-label="Rahmen anspringen">
            {frames.map(node => <Button key={node.id} variant="ghost" size="sm" onClick={() => focusFrame(node)}>{nodeName(node, typeOf.get(node.type))}</Button>)}
            <Button variant="ghost" size="sm" onClick={() => flow.fitView({ padding: fitPadding, duration: 0 })}>Alles</Button></nav></>}
          {status && <span className="px-2 text-sm text-muted-foreground" role="status">{status}</span>}
        </Panel>
        {error && <Panel position="top-right"><p className="flow-alert" role="alert">{error} <Button variant="outline" size="sm" onClick={() => { setError(''); refresh() }}>Erneut versuchen</Button></p></Panel>}
        <Panel position="bottom-center" className="flex items-center gap-2 rounded-xl border bg-popover p-1" role="toolbar" aria-label="Werkzeuge">
          <Button variant={hand ? 'ghost' : 'secondary'} size="icon" aria-pressed={!hand} aria-label="Auswählen" title="Auswählen" onClick={() => setHand(false)}><MousePointer2/></Button>
          <Button variant={hand ? 'secondary' : 'ghost'} size="icon" aria-pressed={hand} aria-label="Verschieben" title="Verschieben (Hand)" onClick={() => setHand(true)}><Hand/></Button>
          <Button variant="outline" aria-haspopup="dialog" onClick={openCentered}><Plus/>Knoten hinzufügen</Button>
          <Button variant="outline" aria-haspopup="dialog" onClick={() => setShowTemplates(true)}><LayoutGrid/>Vorlage</Button>
        </Panel>
      </ReactFlow>
      {strip && (!step || step === 'storyboard') && (() => {
        const { shots, film } = filmOf()
        return <Filmstrip shots={shots} film={film} onRun={run} onCreate={createSteps} onReorder={reorder} onClose={() => setStrip(false)}
          onFocus={id => (hidden.has(id) ? ctx.toast('Dieser Schritt liegt in einer anderen Phase. Öffne ihn über „Ganzer Flow“.') : focusNode(id))}/>
      })()}
      {step === 'storyboard' && !strip && stepFrame && <Button variant="outline" className="flow-strip-open" onClick={() => setStrip(true)}><Clapperboard/>Filmstreifen</Button>}
      {step && !stepFrame && <div className="flow-start">
        <strong>{steps[step].title} fehlt in diesem Projekt</strong>
        <p>{steps[step].empty} Der Schritt gehört zum Flow des Projekts und lässt sich dort mit den anderen Schritten verbinden.</p>
        <div className="flex flex-wrap gap-2">
          {templates.some(item => item.phase === step) && <Button size="lg" variant="brand" disabled={inserting} onClick={() => insertTemplate(templates.find(item => item.phase === step))}>{steps[step].title} anlegen</Button>}
          <Button asChild size="lg" variant="outline"><a href={route(project)} className="no-underline">Ganzen Flow öffnen</a></Button>
        </div>
      </div>}
      {!step && !doc.nodes.length && <div className="flow-start">
        <strong>Dieses Projekt hat noch keinen Flow</strong>
        <p>Hier liegen Moodboard, Storyboard und alle KI-Schritte auf einer Fläche. Füge Bilder per Einfügen oder Hineinziehen ein, ordne sie in Rahmen und verbinde sie mit Bild- und Videoknoten. Kostenpflichtiges läuft nur, wenn du auf „Ausführen“ klickst.</p>
        {boards > 0
          ? <div className="flex flex-wrap gap-2"><Button size="lg" variant="brand" onClick={importBoards}>Moodboard und Storyboard übernehmen</Button><Button size="lg" variant="outline" onClick={() => setShowTemplates(true)}>Mit Vorlage beginnen</Button></div>
          : <div className="flex flex-wrap gap-2"><Button size="lg" variant="brand" onClick={() => setShowTemplates(true)}>Mit Vorlage beginnen</Button><Button size="lg" variant="outline" onClick={openCentered}>Knoten hinzufügen</Button></div>}
        {boards > 0 && <p className="text-sm">Aus den bisherigen Boards entstehen {boards} Knoten in Rahmen. Die alten Boards bleiben gespeichert.</p>}
      </div>}
      {menu && <AddMenu types={types} at={menu} filter={menu.filter} onClose={() => setMenu(null)} onPick={type => addNode(type, menu.position, menu.filter)}
        {...(menu.filter?.side === 'target' && menu.filter.kind !== 'text' && typeOf.has('library') && {
          onUpload: () => uploadAssets(addNode(typeOf.get('library'), menu.position, menu.filter)),
          onLibrary: () => pickAssets(addNode(typeOf.get('library'), menu.position, menu.filter)),
        })}/>}
      {picker && <AssetPicker ctx={ctx} single={picker.single} initial={picker.board ? [] : state.data.nodes.find(n => n.id === picker.id)?.params?.assetIds ?? []} onClose={() => setPicker(null)}
        onDone={ids => { if (picker.board) addToBoard(picker.id, ids); else update(picker.id, n => ({ ...n, params: { ...n.params, assetIds: ids } })); setPicker(null) }}/>}
      {viewer && <Viewer {...viewer} ids={viewer.nodeId ? (state.data.nodes.find(n => n.id === viewer.nodeId)?.params?.assetIds ?? []) : viewer.ids}
        onIndex={index => setViewer({ ...viewer, index })} onClose={() => setViewer(null)}/>}
      {showTemplates && <Templates list={templates} busy={inserting} onClose={() => setShowTemplates(false)} onPick={insertTemplate}/>}
      {confirm && <Confirm steps={confirm.steps} onNo={() => setConfirm(null)} onYes={() => confirm.start().catch(e => setError(e.message))}/>}
    </div>
  </Actions.Provider>
}

function Page({ ctx, project, step, page }) {
  const [loaded, setLoaded] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    const path = '/projects/' + project + '/apps/'
    Promise.all([ctx.api(path + 'flow'), flowsApi('/nodes'), flowsApi('/projects/' + project + '/import-boards'), flowsApi('/templates')])
      .then(([record, types, boards, templates]) => { if (active) setLoaded({ record, types, boards: boards.nodes, templates }) })
      .catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [attempt])
  if (error) return <p role="alert" className="canvas-note err">{error} <button className="btn sm" onClick={() => setAttempt(attempt + 1)}>Erneut versuchen</button></p>
  if (!loaded) return <div className="flow-shell flow-loading" role="status" aria-label="Flow lädt"><span/><span/><span/></div>
  return <ReactFlowProvider><Canvas ctx={ctx} project={project} step={step} page={page} {...loaded}/></ReactFlowProvider>
}

/**
 * Mounts the editor for the project in the route (or the first project) and unmounts when the container leaves the page.
 * @param {{ step?: keyof typeof steps, page?: string }} [options] a step page (`step`) under its sidebar route (`page`).
 */
export function mount(container, ctx, { step = null, page = 'flows' } = {}) {
  const project = ctx.projects.find(item => item.id === ctx.params.get('project')) ?? ctx.projects[0]
  if (project && !ctx.params.get('project')) history.replaceState(null, '', route(project.id, page))
  const root = createRoot(container)
  const observer = new MutationObserver(() => { if (!container.isConnected) { observer.disconnect(); root.unmount() } })
  observer.observe(document.body, { childList: true, subtree: true })
  root.render(project ? <Page key={project.id} ctx={ctx} project={project.id} step={step} page={page}/>
    : <div className="flow-start static"><strong>Noch kein Projekt</strong><p>Ein Flow gehört zu einem Projekt. Lege über das Plus neben „Projekte“ eines an.</p></div>)
}
