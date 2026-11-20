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
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, NodeResizer, NodeToolbar, Panel, Position, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './ui/flows.css'
import {
  Archive, AudioLines, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Copy, Download, Hand, History, Image, LayoutGrid,
  Link, MoreHorizontal, MousePointer2, Palette, Play, Plus, Scissors, SlidersHorizontal, Sparkles, Trash2, Type, Upload, User, Video, Volume2, VolumeX,
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

const flowsApi = async (path, method = 'GET', body) => {
  const response = await fetch('/creativity-flows/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.error || `Flows antwortet mit ${response.status}.`)
  return data
}
const mediaUrl = id => '/creativity-hub/api/media/' + encodeURIComponent(id)
const route = project => '#/flows?project=' + encodeURIComponent(project)

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

/** A Library file drawn with the hub's own media element (image, video with controls, audio, link card). */
function Media({ asset, ctx, full = false }) {
  const host = useRef(null)
  useEffect(() => { if (asset) host.current.replaceChildren(full ? ctx.withFullscreen(asset, ctx.media(asset, { full: true })) : ctx.media(asset)) }, [asset, ctx, full])
  return <div ref={host} className="flow-media"/>
}

function Seconds({ since }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return since ? <span className="tabular-nums">{Math.max(0, Math.round((now - Date.parse(since)) / 1000))} s</span> : null
}

function Preview({ type, view }) {
  const { ctx, assets } = useContext(Actions)
  const [page, setPage] = useState(0)
  const media = type.outputs.filter(port => port.kind !== 'text').flatMap(port => view?.outputs?.[port.id] ?? []).filter(id => assets[id])
  const busy = view?.status === 'running' || view?.status === 'waiting'
  useEffect(() => setPage(0), [media.join()])
  if (!media.length) {
    return <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md bg-background p-4 text-center text-[13px] text-muted-foreground">
      <Icon name={type.outputs[0]?.kind ?? 'image'} className="size-5"/>
      <span>{busy ? <>{statusNames[view.status]} <Seconds since={view.startedAt}/></> : 'Hier erscheint dein Ergebnis.'}</span>
    </div>
  }
  const shown = media[Math.min(page, media.length - 1)]
  return <div className="relative overflow-hidden rounded-md bg-background">
    <Media asset={assets[shown]} ctx={ctx} full/>
    {busy && <span className="absolute left-2 top-2 rounded-sm bg-black/70 px-2 py-0.5 text-xs">{statusNames[view.status]} <Seconds since={view.startedAt}/></span>}
    {media.length > 1 && <div className="nodrag absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 p-0.5 text-xs tabular-nums">
      <Button variant="ghost" size="icon-sm" aria-label="Vorheriges Ergebnis" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft/></Button>
      <span>{page + 1} / {media.length}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Nächstes Ergebnis" disabled={page >= media.length - 1} onClick={() => setPage(page + 1)}><ChevronRight/></Button>
    </div>}
  </div>
}

function RunButton({ node, view }) {
  const { run } = useContext(Actions)
  const [open, setOpen] = useState(false)
  const busy = view?.status === 'running' || view?.status === 'waiting'
  const label = view?.status === 'failed' ? 'Erneut ausführen' : view?.status === 'done' ? 'Neu ausführen' : 'Ausführen'
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
      <span className="truncate">{current ? optionLabel(current) : field.label}</span><ChevronDown/></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[360px] p-0">
      <Command filter={contains}>
        <CommandInput placeholder={field.label + ' suchen'}/>
        {tags.length > 1 && <div className="flex flex-wrap gap-1 border-b p-2">{tags.map(item =>
          <Button key={item} variant={tag === item ? 'default' : 'outline'} size="xs" className="rounded-full" aria-pressed={tag === item} onClick={() => setTag(tag === item ? '' : item)}>{item}</Button>)}</div>}
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
 * Prompt field with `@` mentions: typing `@` lists the names that can be mentioned here, and a chosen name is inserted
 * as `@Name`. The engine turns the name into the reference mark of the connected input when the node runs.
 */
function PromptField({ node, type, names }) {
  const { update } = useContext(Actions)
  const field = useRef(null)
  const [query, setQuery] = useState(null)
  const [active, setActive] = useState(0)
  const matches = query === null ? [] : names.filter(name => name.toLocaleLowerCase('de').startsWith(query.toLocaleLowerCase('de'))).slice(0, 6)
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
    : node.type === 'scene' ? 'Was passiert in dieser Einstellung?'
      : names.length ? 'Beschreibe, was entstehen soll. Mit @ sprichst du eine Referenz an.' : 'Beschreibe, was entstehen soll.'
  return <div className="nodrag relative">
    <textarea ref={field} className="flow-prompt nowheel" rows={node.type === 'text' ? 6 : 3} aria-label={nodeName(node, type) + ': Text'}
      placeholder={placeholder} value={node.prompt ?? ''}
      onChange={e => { update(node.id, n => ({ ...n, prompt: e.target.value })); track(e.target) }}
      onKeyDown={e => {
        if (!matches.length) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length) }
        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[active]) }
        else if (e.key === 'Escape') setQuery(null)
      }}
      onBlur={() => setTimeout(() => setQuery(null), 150)}/>
    {matches.length > 0 && <div role="listbox" aria-label="Referenz einfügen" className="absolute left-0 top-full z-10 mt-1 [display:grid] min-w-48 rounded-md border bg-popover p-1 text-popover-foreground">
      {matches.map((name, i) => <button key={name} role="option" aria-selected={i === active}
        className={cn('flex min-h-9 items-center rounded-sm px-3 text-left text-sm', i === active ? 'bg-accent' : 'hover:bg-accent')}
        onMouseDown={e => { e.preventDefault(); insert(name) }}>@{name}</button>)}
    </div>}
  </div>
}

/** Reference chips of a run node: mark, name and thumbnail of each connected file; a click mentions the node in the prompt. */
function References({ node, view }) {
  const { ctx, assets, update } = useContext(Actions)
  const [all, setAll] = useState(false)
  const refs = view?.refs ?? []
  if (!refs.length) return null
  const shown = all || refs.length <= 5 ? refs : refs.slice(0, 4)
  const chip = 'flow-ref h-8 gap-1 px-2 pl-0.5 text-xs font-normal'
  return <div className="nodrag flex flex-wrap gap-1" aria-label="Referenzen">
    {shown.map(ref => <Button key={ref.mark} variant="outline" size="sm" className={chip} title={`${ref.mark} ist „${ref.name}“. Klicken fügt @${ref.name} in den Prompt ein.`}
      onClick={() => update(node.id, n => ({ ...n, prompt: ((n.prompt ?? '').replace(/\s*$/, '') + ' @' + ref.name + ' ').trimStart() }))}>
      {assets[ref.value] && <Media asset={assets[ref.value]} ctx={ctx}/>}<span className="truncate"><b className="font-semibold text-foreground">{ref.mark}</b> {ref.name}</span></Button>)}
    {refs.length > shown.length && <Button variant="outline" size="sm" className={chip + ' pl-2'} onClick={() => setAll(true)}>+{refs.length - shown.length} weitere</Button>}
    {all && refs.length > 5 && <Button variant="outline" size="sm" className={chip + ' pl-2'} onClick={() => setAll(false)}>Weniger</Button>}
  </div>
}

function AssetStrip({ node, single }) {
  const { ctx, pickAssets, uploadAssets, assets } = useContext(Actions)
  const ids = node.params?.assetIds ?? []
  const shown = ids.filter(id => assets[id])
  return <>
    {shown.length === 1 ? <div className="overflow-hidden rounded-md bg-background"><Media asset={assets[shown[0]]} ctx={ctx} full/></div>
      : shown.length > 1 && <div className="flow-thumbs [display:grid] grid-cols-4 gap-1">{shown.slice(0, 8).map(id => <Media key={id} asset={assets[id]} ctx={ctx}/>)}</div>}
    {ids.length > shown.length && <p className="text-xs text-muted-foreground">{ids.length - shown.length === 1 ? 'Eine Datei gibt es nicht mehr in der Library.' : `${ids.length - shown.length} Dateien gibt es nicht mehr in der Library.`}</p>}
    <div className="nodrag flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => pickAssets(node, single)}>{single ? (ids.length ? 'Startbild ändern' : 'Startbild wählen') : ids.length ? `${ids.length} gewählt · Ändern` : 'Aus der Library wählen'}</Button>
      {!single && <Button variant="outline" size="sm" onClick={() => uploadAssets(node)}><Upload/>Hochladen</Button>}
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
      <label className="nodrag [display:grid] grid-cols-[1fr_144px] items-center gap-2 text-[13px] text-muted-foreground"><span>Dauer</span>
        <select className={selectClass} value={node.params?.duration ?? duration.default} onChange={e => set('duration', e.target.value)}>
          {duration.options.map(option => <option key={option} value={option}>{option} s</option>)}</select></label>
    </>
  }
  if (node.type === 'color') {
    const color = /^#[0-9a-f]{6}$/i.test(node.params?.color ?? '') ? node.params.color : '#8A6A4F'
    return <>
      <div className="h-24 rounded-md border" style={{ backgroundColor: color }}/>
      <label className="nodrag flex items-center justify-between text-[13px] text-muted-foreground"><span className="tabular-nums">{color.toUpperCase()}</span>
        <input type="color" aria-label="Farbton" className="h-8 w-11 cursor-pointer rounded-sm border border-input bg-transparent p-0" value={color} onChange={e => set('color', e.target.value)}/></label>
    </>
  }
  if (node.type === 'link') {
    const url = node.params?.url ?? ''
    return <div className="nodrag [display:grid] gap-2">
      <input className="text-in" type="url" aria-label="Adresse" placeholder="https://…" value={url} onChange={e => set('url', e.target.value.trim())}/>
      {/^https?:\/\//i.test(url) && <a className="text-[13px] text-muted-foreground hover:text-foreground" href={url} target="_blank" rel="noreferrer">{domainOf(url)} öffnen</a>}
    </div>
  }
  return null
}

/** Header above the card (ElevenLabs layout): type icon and name left, model or a short fact right; doubles as drag handle and rename field. */
function NodeHeader({ node, type, right, className }) {
  const { rename, renaming, setRenaming } = useContext(Actions)
  const editing = renaming === node.id
  return <header className={cn('flow-drag flex h-7 cursor-grab items-center gap-1.5 px-1 text-xs text-muted-foreground', className)}>
    <Icon name={type.icon} className="size-3.5 shrink-0"/>
    {editing
      ? <input autoFocus className="nodrag h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-xs text-foreground" defaultValue={node.name ?? ''} placeholder={type.title}
        aria-label="Name des Knotens" maxLength={40}
        onBlur={e => { rename(node.id, e.target.value.trim()); setRenaming(null) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }}/>
      : <span className="truncate font-medium text-secondary-foreground" onDoubleClick={() => setRenaming(node.id)} title="Doppelklick zum Umbenennen">{nodeName(node, type)}</span>}
    {right && <span className="ml-auto max-w-[55%] truncate tabular-nums">{right}</span>}
  </header>
}

/** A frame is a React Flow group node: its children (`parentId`) move with it and lie inside it. */
function FrameNode({ id, data, selected }) {
  const { update, remove, edges } = useContext(Actions)
  const { node, type, view } = data
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
  const { run, remove, duplicate, copyNodes, pasteNodes, focusNode, setRenaming, pick } = useContext(Actions)
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
      <DropdownMenuItem onSelect={() => copyNodes([node.id])}>Kopieren<DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => pasteNodes()}>Einfügen<DropdownMenuShortcut>⌘V</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => duplicate(node.id)}>Duplizieren<DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => focusNode(node.id)}>Knoten fokussieren<DropdownMenuShortcut>⌘.</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuSeparator/>
      <DropdownMenuItem variant="destructive" onSelect={() => remove(node.id)}>Knoten löschen<DropdownMenuShortcut>⌫</DropdownMenuShortcut></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

function FlowNode({ id, data, selected }) {
  const { update, remove, duplicate, run, edges, mentionNames } = useContext(Actions)
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
  // Run nodes can mention what is connected to them; notes can mention every file node, resolved where the text arrives.
  const names = type.inputs.some(port => port.mark) ? [...new Set((view?.refs ?? []).map(ref => ref.name))] : node.type === 'text' ? mentionNames : []
  const status = view?.status === 'running' || view?.status === 'waiting' ? 'loading' : view?.status === 'failed' ? 'error' : 'initial'
  const right = modelName || (node.type === 'text' ? `${(node.prompt ?? '').length} Zeichen` : node.name ? type.title : '')
  const runsAfter = !type.runs && edges.some(edge => edge.source === id)
  return <>
    <div className={cn(type.runs ? 'w-80' : 'w-64')} style={{ minHeight: 28 + tall * 40 }}>
      <NodeHeader node={node} type={type} right={right}/>
      <NodeStatusIndicator status={status}>
        <BaseNode className={cn('flow-node overflow-hidden rounded-xl', node.type === 'text' && 'bg-[var(--c-fill)]')}>
          {type.runs && type.outputs.some(port => port.kind !== 'text') && <Preview type={type} view={view}/>}
          <BaseNodeContent className={cn(type.runs && type.outputs.some(port => port.kind !== 'text') && 'border-t')}>
            <NodeBody node={node} type={type}/>
            {type.fields.filter(field => field.type === 'longtext').map(field => <label key={field.key} className="nodrag [display:grid] gap-1 text-xs text-muted-foreground"><span>{field.label}</span>
              <textarea className="flow-prompt nowheel" rows={3} placeholder={field.placeholder} value={node.params?.[field.key] ?? ''}
                onChange={e => update(id, n => ({ ...n, params: { ...n.params, [field.key]: e.target.value } }))}/></label>)}
            {type.prompt && <PromptField node={node} type={type} names={names}/>}
            <References node={node} view={view}/>
            {(view?.warnings ?? []).map(text => <p key={text} className="flow-warning" role="status">{text}</p>)}
            {view?.status === 'failed' && view.error && <p className="flow-error" role="alert">{view.error}</p>}
            {view?.status === 'unknown' && <p className="flow-error">{view.error}</p>}
            {(type.runs || runsAfter) && <div className="flex items-center justify-between gap-2">
              <span className={cn('text-xs tabular-nums text-muted-foreground', view?.stale && 'text-[var(--c-port-audio)]')}>{state}{view?.status === 'done' && typeof view.credits === 'number' ? ` · ${view.credits} Credits` : ''}</span>
              {type.runs ? <RunButton node={node} view={view}/> : <Button size="sm" className="nodrag" onClick={() => run(id, 'downstream')}><Play/>Ab hier ausführen</Button>}
            </div>}
          </BaseNodeContent>
        </BaseNode>
      </NodeStatusIndicator>
    </div>
    <Ports ports={type.inputs} side="in" connected={inbound} nodeId={id}/>
    <Ports ports={outputs} side="out" connected={outbound} nodeId={id}/>
    {/* Always open, like ElevenLabs: model, the main settings and the actions; rare actions sit in ⋯. */}
    <NodeToolbar isVisible position={Position.Bottom} offset={8} className="nodrag flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-[var(--shadow-subtle-4,none)]">
      {modelField && <Picker field={modelField} value={String(model)} onChange={value => update(id, n => withField(n, modelField, value))}/>}
      {quick.map(field => <QuickSetting key={(field.model ?? '') + field.key} node={node} field={field}/>)}
      {more.length > 0 && <Popover>
        <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Weitere Einstellungen" title="Weitere Einstellungen"><SlidersHorizontal/></Button></PopoverTrigger>
        <PopoverContent className="[display:grid] w-80 gap-2">{more.map(field => <label key={(field.model ?? '') + field.key} className="[display:grid] min-h-9 grid-cols-[1fr_144px] items-center gap-2 text-[13px] text-secondary-foreground">
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
    </NodeToolbar>
  </>
}
const nodeTypes = { flow: FlowNode, frame: FrameNode }

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
          <CommandItem value="Hochladen Datei vom Mac" onSelect={onUpload}><Upload/><span className="[display:grid]"><b className="font-semibold">Hochladen</b><span className="text-xs text-muted-foreground">Vom Mac in die Sammlung, dann hier verbunden.</span></span></CommandItem>
          <CommandItem value="Aus Sammlung und Library wählen" onSelect={onLibrary}><Archive/><span className="[display:grid]"><b className="font-semibold">Aus Sammlung und Library</b><span className="text-xs text-muted-foreground">Vorhandene Dateien wählen.</span></span></CommandItem>
        </CommandGroup>}
        {groups.map(([group, title]) => {
          const items = list.filter(type => type.group === group)
          return items.length > 0 && <CommandGroup key={group} heading={title}>
            {items.map(type => <CommandItem key={type.type} value={type.title + ' ' + type.description} onSelect={() => onPick(type)} className="items-start">
              <Icon name={type.icon} className="mt-0.5 size-4"/><span className="[display:grid] gap-0.5"><b className="font-semibold">{type.title}{type.paid ? ' · kostet Credits' : ''}</b>
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
          className="[display:grid] content-start gap-1 rounded-md border bg-card p-3 text-left text-[13px] leading-[18px] text-secondary-foreground hover:bg-secondary active:bg-accent disabled:opacity-50">
          <b className="text-[15px] text-foreground">{item.title}</b><span>{item.description}</span>{item.phases > 0 && <small className="text-muted-foreground">{item.phases === 1 ? '1 Rahmen' : `${item.phases} Rahmen`}</small>}</button>)}</div>
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
      <ol className="list-decimal pl-5 text-sm">{steps.map(step => <li key={step.id}>{step.title}{step.paid ? ' · kostet Credits' : ''}</li>)}</ol>
      <DialogFooter><Button variant="outline" autoFocus onClick={onNo}>Abbrechen</Button><Button onClick={onYes}>Alle ausführen</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function Canvas({ ctx, project, record, types, boards, templates }) {
  const flow = useReactFlow()
  const typeOf = useMemo(() => new Map(types.map(type => [type.type, type])), [types])
  const isFrame = node => Boolean(typeOf.get(node.type)?.contains)
  const settle = doc => adoptIntoFrames(doc, isFrame).doc
  const initial = useMemo(() => adoptIntoFrames({ nodes: [], edges: [], ...record.data }, isFrame), [])
  const [doc, setDoc] = useState(initial.doc)
  const [view, setView] = useState({ nodes: {}, assets: {} })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(null)
  const [picker, setPicker] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [hand, setHand] = useState(false)
  const [renaming, setRenaming] = useState(null)
  // React Flow's own colours (controls, minimap) follow the hub theme switch.
  const [colorMode, setColorMode] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const follow = () => setColorMode(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    addEventListener('atelier-theme', follow)
    return () => removeEventListener('atelier-theme', follow)
  }, [])
  // React Flow's own per-node state (measured size, selection, dragging, live resize), kept by its changesets.
  const [meta, setMeta] = useState({})
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
  function pickAssets(node, single = false) { setPicker({ id: node.id, single }) }
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
      if (created.length) update(node.id, n => ({ ...n, params: { ...n.params, assetIds: [...(n.params?.assetIds ?? []), ...created.map(item => item.id)].slice(0, 24) } }))
    }
    input.click()
  }
  /** Places pasted or dropped files, text and links as nodes at a canvas position, side by side. */
  async function place(position, { files = [], text = '' }) {
    const nodes = []
    const at = i => ({ x: Math.round(position.x + i * 304), y: Math.round(position.y) })
    if (files.length) {
      setStatus('Lädt hoch …')
      const created = await storeFiles(files)
      created.forEach(asset => nodes.push({ id: crypto.randomUUID(), type: 'library', ...at(nodes.length), prompt: '', params: { assetIds: [asset.id] } }))
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
      place(flow.screenToFlowPosition(pointer.current ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 }), { files, text }).catch(report)
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
    flow.fitBounds({ x: node.x, y: node.y, width: node.params?.width ?? 640, height: node.params?.height ?? 480 }, { padding: 0.08, duration: 0 })
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
  const edges = doc.edges.map(edge => ({ ...edge, zIndex: 1, animated: running(edge.target), className: 'flow-edge kind-' + (portKind(edge.source, edge.sourceHandle, 'source') ?? 'text') }))
  const nodes = doc.nodes.map(node => {
    const frame = isFrame(node)
    const own = meta[node.id] ?? {}
    return {
      id: node.id, type: frame ? 'frame' : 'flow', position: { x: node.x, y: node.y }, ...(node.parentId && { parentId: node.parentId }),
      dragHandle: frame ? '.flow-frame-head' : '.flow-drag', zIndex: 2, selected: own.selected, dragging: own.dragging, measured: own.measured,
      ...(frame && { width: own.width ?? node.params?.width ?? 640, height: own.height ?? node.params?.height ?? 480, zIndex: 0, style: { pointerEvents: 'none' } }),
      data: { node, type: typeOf.get(node.type), view: view.nodes[node.id] },
    }
  })
  const frames = doc.nodes.filter(isFrame).sort((a, b) => (a.x - b.x) || (a.y - b.y))
  const mentionNames = [...new Set(doc.nodes.filter(node => typeOf.get(node.type)?.outputs.some(port => port.kind !== 'text') && !isFrame(node))
    .map(node => nodeName(node, typeOf.get(node.type))))]
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
  const selectedIds = () => Object.entries(meta).filter(([, value]) => value.selected).map(([id]) => id)
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
  const actions = { ctx, assets: view.assets, edges: doc.edges, update, remove, duplicate, run, pick, pickAssets, uploadAssets, mentionNames, portMenu,
    renaming, setRenaming, rename, copyNodes, pasteNodes, focusNode }

  return <Actions.Provider value={actions}>
    <div className="flow-shell" ref={shell}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.1} maxZoom={2}
        panOnDrag={hand ? true : [1, 2]} selectionOnDrag={!hand} panOnScroll proOptions={{ hideAttribution: true }} colorMode={colorMode}
        deleteKeyCode={['Backspace', 'Delete']} isValidConnection={valid} connectOnClick={false}
        // Fixed layers: frames 0, lines 1, nodes 2, so lines never cover a node, also inside frames.
        zIndexMode="manual" elevateEdgesOnSelect={false}
        onNodesChange={changeset => {
          // React Flow 13: the changeset applies itself to the nodes; the result goes back into the flow and the per-node state.
          const next = changeset.applyTo(nodes)
          const moved = next.filter(item => { const node = byId.get(item.id); return node && (item.position.x !== node.x || item.position.y !== node.y) })
          const gone = doc.nodes.filter(node => !next.some(item => item.id === node.id)).map(node => node.id)
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
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={event => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          place(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), { files: [...event.dataTransfer.files] }).catch(report)
        }}
        onEdgeDoubleClick={(_, edge) => change(d => ({ edges: d.edges.filter(item => item.id !== edge.id) }))}>
        <Background gap={24} size={1.5} color="var(--c-dot)"/>
        <Controls showInteractive={false} position="bottom-right"/>
        <MiniMap position="bottom-left" pannable zoomable ariaLabel="Übersicht der Fläche" bgColor="var(--c-panel)" maskColor="var(--c-tint-3)"
          nodeColor={item => (isFrame(byId.get(item.id) ?? {}) ? 'var(--c-fill-2)' : 'var(--c-fill-4)')}/>
        <Panel position="top-left" className="flex flex-wrap items-center gap-3">
          <select className="text-in w-auto max-w-72" aria-label="Projekt" value={project} onChange={async e => { try { await flush(); location.hash = route(e.target.value) } catch (err) { report(err) } }}>
            {ctx.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <span className="text-[13px] text-muted-foreground" role="status">{status}</span>
          {frames.length > 1 && <nav className="flex flex-wrap gap-1" aria-label="Rahmen anspringen">
            {frames.map(node => <Button key={node.id} variant="outline" size="sm" className="rounded-full bg-popover" onClick={() => focusFrame(node)}>{nodeName(node, typeOf.get(node.type))}</Button>)}
            <Button variant="outline" size="sm" className="rounded-full bg-popover" onClick={() => flow.fitView({ padding: 0.1, duration: 0 })}>Alles</Button></nav>}
        </Panel>
        {error && <Panel position="top-right"><p className="flow-alert" role="alert">{error} <Button variant="outline" size="sm" onClick={() => { setError(''); refresh() }}>Erneut versuchen</Button></p></Panel>}
        <Panel position="bottom-center" className="flex items-center gap-2 rounded-xl border bg-popover p-1" role="toolbar" aria-label="Werkzeuge">
          <Button variant={hand ? 'ghost' : 'secondary'} size="icon" aria-pressed={!hand} aria-label="Auswählen" title="Auswählen" onClick={() => setHand(false)}><MousePointer2/></Button>
          <Button variant={hand ? 'secondary' : 'ghost'} size="icon" aria-pressed={hand} aria-label="Verschieben" title="Verschieben (Hand)" onClick={() => setHand(true)}><Hand/></Button>
          <Button variant="outline" aria-haspopup="dialog" onClick={openCentered}><Plus/>Knoten hinzufügen</Button>
          <Button variant="outline" aria-haspopup="dialog" onClick={() => setShowTemplates(true)}><LayoutGrid/>Vorlage</Button>
        </Panel>
      </ReactFlow>
      {!doc.nodes.length && <div className="flow-start">
        <strong>Dieses Projekt hat noch keinen Flow</strong>
        <p>Hier liegen Moodboard, Storyboard und alle KI-Schritte auf einer Fläche. Füge Bilder per Einfügen oder Hineinziehen ein, ordne sie in Rahmen und verbinde sie mit Bild- und Videoknoten. Kostenpflichtiges läuft nur, wenn du auf „Ausführen“ klickst.</p>
        {boards > 0
          ? <div className="flex flex-wrap gap-2"><Button size="lg" variant="brand" onClick={importBoards}>Moodboard und Storyboard übernehmen</Button><Button size="lg" variant="outline" onClick={() => setShowTemplates(true)}>Mit Vorlage beginnen</Button></div>
          : <div className="flex flex-wrap gap-2"><Button size="lg" variant="brand" onClick={() => setShowTemplates(true)}>Mit Vorlage beginnen</Button><Button size="lg" variant="outline" onClick={openCentered}>Knoten hinzufügen</Button></div>}
        {boards > 0 && <p className="text-[13px]">Aus den bisherigen Boards entstehen {boards} Knoten in Rahmen. Die alten Boards bleiben gespeichert.</p>}
      </div>}
      {menu && <AddMenu types={types} at={menu} filter={menu.filter} onClose={() => setMenu(null)} onPick={type => addNode(type, menu.position, menu.filter)}
        {...(menu.filter?.side === 'target' && menu.filter.kind !== 'text' && typeOf.has('library') && {
          onUpload: () => uploadAssets(addNode(typeOf.get('library'), menu.position, menu.filter)),
          onLibrary: () => pickAssets(addNode(typeOf.get('library'), menu.position, menu.filter)),
        })}/>}
      {picker && <AssetPicker ctx={ctx} single={picker.single} initial={state.data.nodes.find(n => n.id === picker.id)?.params?.assetIds ?? []} onClose={() => setPicker(null)}
        onDone={ids => { update(picker.id, n => ({ ...n, params: { ...n.params, assetIds: ids } })); setPicker(null) }}/>}
      {showTemplates && <Templates list={templates} busy={inserting} onClose={() => setShowTemplates(false)} onPick={insertTemplate}/>}
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
    Promise.all([ctx.api(path + 'flow'), flowsApi('/nodes'), flowsApi('/projects/' + project + '/import-boards'), flowsApi('/templates')])
      .then(([record, types, boards, templates]) => { if (active) setLoaded({ record, types, boards: boards.nodes, templates }) })
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
