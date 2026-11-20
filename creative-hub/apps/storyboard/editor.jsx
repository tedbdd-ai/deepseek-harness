import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Player } from '@remotion/player'
import { AbsoluteFill, Sequence, Img, Video } from 'remotion'
import { ReactFlow, Background, Controls, Handle, Position, MarkerType } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const url = id => '/creativity-hub/api/media/' + encodeURIComponent(id)
const route = (board, project) => '#/' + board + '?project=' + encodeURIComponent(project)
const newShot = () => ({ id: crypto.randomUUID(), title: '', prompt: '', duration: 5, ref: '' })

function Film({ shots, clips }) {
  let offset = 0
  return shots.map((s, i) => {
    const length = s.duration * 24
    const from = offset
    offset += length
    const style = { width: '100%', height: '100%', objectFit: 'contain' }
    return <Sequence key={s.id} from={from} durationInFrames={length}><AbsoluteFill style={{background:'var(--c-bg)', color:'var(--c-ink)', justifyContent:'center', alignItems:'center'}}>
      {clips[s.id] ? <Video src={url(clips[s.id])} style={style}/> : s.ref ? <Img src={url(s.ref)} style={style}/> : <strong>{s.title || 'Einstellung ' + (i+1)}</strong>}
    </AbsoluteFill></Sequence>
  })
}

const Icon = ({ name }) => <svg className="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  {name === 'x' ? <path d="M18 6 6 18M6 6l12 12"/> : <path d="M5 12h14M12 5v14"/>}</svg>
const boardNames = { storyboard: 'Storyboard', moodboard: 'Moodboard' }
const safeLink = value => /^https?:\/\//i.test(value || '') ? value : undefined

function Preview({ asset, ctx }) {
  const host = useRef(null)
  useEffect(() => {
    if (!asset) return
    host.current.replaceChildren(ctx.withFullscreen(asset, ctx.media(asset, {full:true})))
  }, [asset, ctx])
  return <div ref={host} className="canvas-media"/>
}

function Card({ data, selected }) {
  return <article className={'atelier-card' + (selected ? ' active' : '')}>
    <Handle type="target" position={Position.Left}/>
    {data.asset && <Preview asset={data.asset} ctx={data.ctx}/>}
    {data.color && <div className="canvas-swatch" style={{backgroundColor:data.color}}/>}
    <div className="canvas-copy"><small>{data.kind}</small><strong>{data.title}</strong>
      {data.text && <p>{data.text}</p>}</div>
    <Handle type="source" position={Position.Right} title="Zum linken Punkt einer anderen Karte ziehen"/>
  </article>
}
const nodeTypes = { card: Card }
const kindNames = { note: 'Notiz', color: 'Farbe', link: 'Link' }

function Workspace({ ctx, project, board, record, library, assigned, initialClips, moodIds }) {
  const {api} = ctx
  const story = board === 'storyboard'
  const path = '/projects/' + project + '/apps/'
  const [doc, setDoc] = useState(() => {
    const base = {story:'', shots:[], cards:[], positions:{}, edges:[], ...record.data}
    // Boards saved before `items` showed every project image; only the ones with a position were really placed.
    if (board === 'moodboard' && !Array.isArray(base.items)) base.items = assigned.filter(a=>base.positions[a.id]).map(a=>({id:a.id}))
    return base
  })
  const [assets,setAssets] = useState(library)
  const [pins,setPins] = useState(assigned)
  const [clips,setClips] = useState(initialClips)
  const [selection, select] = useState(ctx.params.get('shot'))
  const [tab,setTab] = useState('board')
  const [status,setStatus] = useState('')
  const [error,setError] = useState('')
  const [pollError,setPollError] = useState(''), [pollRetry,setPollRetry] = useState(0)
  const [undo,setUndo] = useState(null)
  const [filter,setFilter] = useState(null)
  const [tray,setTray] = useState(null)
  const canvas = useRef(null), flow = useRef(null)
  const state = useRef({data:doc, saved:doc, revision:record.revision, timer:null, saving:null}).current
  async function flush() {
    clearTimeout(state.timer)
    if (state.saving) return state.saving
    state.saving = (async () => {
      while (state.saved !== state.data) {
        const data = state.data
        const result = await api(path+board,'PUT',{data,revision:state.revision})
        state.revision = result.revision
        state.saved = data
      }
      setStatus('Gespeichert')
    })()
    try { await state.saving } finally { state.saving = null }
  }
  function change(update) {
    state.data = {...state.data,...update(state.data)}
    setDoc(state.data)
    setStatus('Speichert …')
    clearTimeout(state.timer)
    state.timer = setTimeout(() => flush().catch(report),350)
  }
  function report(e) {setError(e.message); setStatus('Speichern prüfen')}
  async function navigate(hash) {try {await flush(); location.hash=hash} catch(e){report(e)}}
  useEffect(() => () => { if (state.saved !== state.data) flush().catch(e=>ctx.toast(e.message,true)) }, [])
  useEffect(() => {
    if (!story) return
    let active=true, timer
    async function poll() {
      try {
        const base='/creativity-influencer/api/jobs'
        const response=await fetch(base)
        if (!response.ok) return
        for (const job of (await response.json()).filter(j=>j.projectId===project && j.shotId && j.status==='queued')) {
          if (!active) return
          await fetch(base+'/'+job.id+'/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
        }
        const record=await api(path+'storyboard-renders')
        if(active) {setClips(record.data); setPollError('')}
      } catch(e) { if(active) setPollError(e.message) }
      finally {if(active) timer=setTimeout(poll,8000)}
    }
    timer=setTimeout(poll,1000)
    return ()=>{active=false; clearTimeout(timer)}
  },[project,story,pollRetry])
  useEffect(()=>{
    if (filter===null) return
    let active=true
    const timer=setTimeout(async()=>{
      try {
        const result=await api('/search?'+new URLSearchParams({q:filter,limit:60}))
        if(!active) return
        setTray(result.items)
        setAssets(prev=>{const known=new Set(prev.map(a=>a.id)); return [...prev,...result.items.filter(a=>!known.has(a.id))]})
      } catch(e) { if(active) setError(e.message) }
    },250)
    return ()=>{active=false; clearTimeout(timer)}
  },[filter])
  const lookup = new Map(assets.map(a=>[a.id,a]))
  const mood = new Set(moodIds)
  const shots = doc.shots
  const scene = shots.find(s=>s.id===selection)
  const card = doc.cards.find(c=>c.id===selection)
  const placedIds = new Set((doc.items ?? []).map(i=>i.id))
  const placed = story ? [] : pins.filter(a=>placedIds.has(a.id))
  const pin = (story ? pins : placed).find(a=>a.id===selection)
  const images = assets.filter(a=>['image/jpeg','image/png','image/webp','image/gif'].includes(a.media_type))
  const statusOf = s => clips[s.id] ? 'Video fertig' : s.ref ? 'Startbild gesetzt' : 'Startbild fehlt'
  const entries = story ? shots.map((s,i)=>({
    id:s.id, shot:true, kind:'Einstellung '+(i+1)+' · '+s.duration+' s · '+statusOf(s), title:s.title || 'Ohne Titel', text:s.prompt,
    asset:clips[s.id] ? {id:clips[s.id],media_type:'video/mp4',title:s.title} : lookup.get(s.ref),
  })) : placed.map(a=>({id:a.id, kind:'Referenz', title:a.title, asset:a}))
  entries.push(...doc.cards.map(c=>({...c,kind:kindNames[c.type],title:c.title || kindNames[c.type]})))
  const columns = story ? 4 : 3
  const shotRows = Math.ceil(shots.length/columns)
  const nodes = entries.map((entry,i)=>({id:entry.id,type:'card',selected:entry.id===selection,
    draggable:!entry.shot,
    position:entry.shot ? {x:40+(i%columns)*285,y:40+Math.floor(i/columns)*300}
      : doc.positions[entry.id] ?? {x:40+(i%columns)*285,y:(story?40+shotRows*300:40)+Math.floor((story?i-shots.length:i)/columns)*275},
    data:{...entry,ctx}}))
  const ids=new Set(nodes.map(n=>n.id))
  const edges=doc.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))
  const sequence=[]
  function insert(type) {
    const item = type === 'shot' ? newShot() : {id:crypto.randomUUID(),type,title:'',text:'',...(type==='color' && {color:'#d79978'})}
    const box=canvas.current.getBoundingClientRect()
    const point=flow.current?.screenToFlowPosition({x:box.left+box.width*.42,y:box.top+box.height*.30}) ?? {x:50,y:50}
    while(nodes.some(n=>Math.abs(n.position.x-point.x)<24 && Math.abs(n.position.y-point.y)<24)){point.x+=32;point.y+=32}
    const key=type==='shot'?'shots':'cards'
    change(d=>({[key]:[...d[key],item],positions:{...d.positions,[item.id]:point}}))
    select(item.id)
  }
  function edit(key,fields) {
    change(d=>({[key]:d[key].map(item=>item.id===selection ? {...item,...fields} : item)}))
  }
  function reorder(delta) {
    const list=shots.slice(), i=list.indexOf(scene)
    list.splice(i+delta,0,list.splice(i,1)[0])
    change(()=>({shots:list}))
  }
  /** Offers one-click undo for ten seconds. */
  function offerUndo(label, run) {
    clearTimeout(state.undoTimer)
    state.undoTimer=setTimeout(()=>setUndo(null),10000)
    setUndo({label,run:async()=>{clearTimeout(state.undoTimer); setUndo(null); try {await run()} catch(e){report(e)}}})
  }
  /** Takes a card, shot or placed image off the board; images stay in the project and the Library. */
  function remove() {
    const before=state.data, id=selection, title=pin?.title
    change(d=>{
      const positions={...d.positions}; delete positions[id]
      return {cards:d.cards.filter(c=>c.id!==id),shots:d.shots.filter(s=>s.id!==id),items:d.items?.filter(i=>i.id!==id),
        edges:d.edges.filter(e=>e.source!==id && e.target!==id),positions}
    })
    select(null)
    offerUndo(pin?'„'+title+'“ vom Board genommen. Das Bild bleibt im Projekt.':story&&scene?'Einstellung entfernt.':'Karte entfernt.',
      async()=>{change(()=>({cards:before.cards,shots:before.shots,items:before.items,edges:before.edges,positions:before.positions})); select(id)})
  }
  /** Removes an image from the project itself (and the board). */
  async function unassign() {
    const removed=pin, before=state.data
    try {
      await api('/unassign','POST',{id:removed.id,projectId:project})
      setPins(prev=>prev.filter(a=>a.id!==removed.id))
      change(d=>({items:d.items?.filter(i=>i.id!==removed.id)}))
      select(null)
      offerUndo('„'+removed.title+'“ aus dem Projekt gelöst.',async()=>{
        await api('/assign','POST',{id:removed.id,projectId:project})
        setPins(prev=>prev.some(a=>a.id===removed.id)?prev:[...prev,removed])
        change(()=>({items:before.items})); select(removed.id)
      })
    } catch(e){report(e)}
  }
  async function addFiles(files, position) {
    try {
      const items=await ctx.uploadFiles(files,{projectId:project})
      setAssets(prev=>[...items,...prev])
      setPins(prev=>[...prev,...items])
      if (items.length) change(d=>({items:[...(d.items??[]),...items.map(a=>({id:a.id}))],
        ...(position && {positions:{...d.positions,...Object.fromEntries(items.map((a,i)=>[a.id,{x:position.x+i*40,y:position.y+i*40}]))}})}))
    } catch(e){report(e)}
  }
  async function assign(asset, position) {
    try {
      await api('/assign','POST',{id:asset.id,projectId:project})
      setPins(prev=>prev.some(a=>a.id===asset.id)?prev:[...prev,asset])
      change(d=>({items:(d.items??[]).some(i=>i.id===asset.id)?d.items:[...(d.items??[]),{id:asset.id}],
        ...(position && {positions:{...d.positions,[asset.id]:position}})}))
      setFilter(null); select(asset.id)
    } catch(e){report(e)}
  }
  async function createFromPin() {
    try {
      await flush()
      const storyboard=await api(path+'storyboard')
      const shot={...newShot(),title:pin.title,ref:pin.id}
      await api(path+'storyboard','PUT',{...storyboard,data:{...storyboard.data,shots:[...(storyboard.data.shots??[]),shot]}})
      location.hash=route('storyboard',project)+'&shot='+shot.id
    } catch(e){report(e)}
  }
  const field=(label,control)=><label className="field"><span>{label}</span>{control}</label>
  const editText=(label,key,obj,prop,multi=false)=>field(label,React.createElement(multi?'textarea':'input',{
    className:'text-in',rows:multi?4:undefined,value:obj[prop]??'',onChange:e=>edit(key,{[prop]:e.target.value})}))
  return <div className="atelier-workspace">
    <div className="canvas-toolbar"><select className="text-in" aria-label="Projekt" value={project} onChange={e=>navigate(route(board,e.target.value))}>{ctx.projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
      {Object.entries(boardNames).map(([id,name])=><button key={id} className="chip" aria-pressed={board===id&&tab==='board'} onClick={()=>board===id?setTab('board'):navigate(route(id,project))}>{name}</button>)}
      {story && <button className="chip" aria-pressed={tab==='preview'} onClick={()=>setTab('preview')}>Filmvorschau</button>}
      <span role="status" className="meta">{status}</span></div>
    <p className="canvas-note meta">{story?'Jede Einstellung ist ein Clip. Ihre Reihenfolge ist die Reihenfolge im Film; Notizen und Farben helfen dir beim Planen.':'Lege hier Bilder, Farben und Notizen ab, die den Look des Films bestimmen. Bilder holst du aus der Sammlung oder der Library.'}</p>
    {error && <p role="alert" className="canvas-note err">{error} <button className="btn sm" onClick={()=>flush().then(()=>setError('')).catch(report)}>Erneut speichern</button></p>}
    {pollError && <p role="alert" className="canvas-note err">Der Stand der Videos ließ sich nicht abrufen. <button className="btn sm" onClick={()=>setPollRetry(n=>n+1)}>Erneut prüfen</button></p>}
    {undo && <p role="status" className="canvas-note">{undo.label} <button className="btn sm" onClick={()=>{const run=undo.run; setUndo(null); run()}}>Rückgängig</button></p>}
    {tab==='preview' ? <>{shots.length ? <Player component={Film} inputProps={{shots,clips}} durationInFrames={shots.reduce((n,s)=>n+s.duration*24,0)} fps={24} compositionWidth={1280} compositionHeight={720} controls style={{width:'100%',maxWidth:960}}/> : <p>Füge zuerst eine Einstellung hinzu.</p>}
      <a href="https://opencut.app/" target="_blank" rel="noreferrer">OpenCut zum Schneiden öffnen</a></> :
    <><div className="canvas-tools">
      {story ? <button className="btn sm" onClick={()=>insert('shot')}><Icon name="plus"/>Einstellung</button> :
        <><button className="btn sm" onClick={()=>setFilter(filter===null?'':null)}><Icon name="plus"/>Referenz</button><label className="btn sm">Dateien hochladen<input type="file" multiple accept="image/*,video/*" hidden onChange={async e=>{
          await addFiles(e.target.files)
        }}/></label></>}
      {Object.entries(kindNames).map(([key,name])=><button className="btn sm" key={key} onClick={()=>insert(key)}><Icon name="plus"/>{name}</button>)}
      {story && <button className="btn sm" onClick={()=>select('story')}>Story bearbeiten</button>}</div>
    {filter!==null && <div className="canvas-library"><input className="text-in" aria-label="Sammlung und Library durchsuchen" autoFocus placeholder="Suchen, auch nach Tags wie „latex neon“" value={filter} onChange={e=>setFilter(e.target.value)}/>
      <div>{tray===null ? <span className="meta">Lädt …</span> : tray.filter(a=>!placedIds.has(a.id)).map(a=><button key={a.id} className="canvas-choice" draggable
        title="Auf die Fläche ziehen oder zum Hinzufügen klicken" onDragStart={e=>{e.dataTransfer.setData('application/x-atelier-asset',a.id); e.dataTransfer.effectAllowed='copy'}}
        onClick={()=>assign(a)}>
        {a.media_type?.startsWith('image/') || a.preview ? <img alt="" loading="lazy" draggable={false} src={a.media_type?url(a.id):a.preview}/> : <small>{a.media_type?.split('/')[0] || 'Quelle'}</small>}
        <span>{a.title}</span></button>)}
        {tray && !tray.filter(a=>!placedIds.has(a.id)).length && <span className="meta">{filter?'Nichts gefunden. Probiere ein Tag wie „latex“ oder „außen“.':'Alles aus der Sammlung liegt schon auf dem Board.'}</span>}</div></div>}
    <div className="canvas-layout"><section className="atelier-plane" ref={canvas} onDragOver={e=>{
      if(!story && e.dataTransfer.types.includes('application/x-atelier-asset')) e.preventDefault()
    }} onDrop={e=>{
      if(story) return
      const asset=lookup.get(e.dataTransfer.getData('application/x-atelier-asset'))
      if(asset){
        e.preventDefault()
        void assign(asset,flow.current?.screenToFlowPosition({x:e.clientX,y:e.clientY}))
        return
      }
      if(!e.dataTransfer.files.length) return
      e.preventDefault()
      void addFiles(e.dataTransfer.files,flow.current?.screenToFlowPosition({x:e.clientX,y:e.clientY}))
    }} aria-label={boardNames[board]+' Arbeitsfläche'}>
      <ReactFlow nodes={nodes} edges={[...sequence,...edges]} nodeTypes={nodeTypes} onInit={instance=>{flow.current=instance}}
        colorMode="dark" fitView minZoom={0.12} maxZoom={2} fitViewOptions={{maxZoom:1,padding:.15}} deleteKeyCode={null}
        onNodesChange={changes=>{
          const moved=changes.getByType('position').filter(c=>c.position)
          if(moved.length) change(d=>({positions:{...d.positions,...Object.fromEntries(moved.map(c=>[c.id,c.position]))}}))
        }}
        onNodeClick={(_,node)=>select(node.id)} onPaneClick={()=>select(null)}
        onConnect={({source,target})=>{if(source!==target && !edges.some(e=>e.source===source&&e.target===target)) change(d=>({edges:[...d.edges,{id:crypto.randomUUID(),source,target}]}))}}
        onEdgeDoubleClick={(_,edge)=>change(d=>({edges:d.edges.filter(e=>e.id!==edge.id)}))}>
        <Background gap={24} size={1} color="var(--c-hair)"/><Controls showInteractive={false}/>
      </ReactFlow>
      {!nodes.length && <div className="canvas-empty"><p>{story?'Noch keine Einstellung. Eine Einstellung ist ein Clip von wenigen Sekunden.':'Das Board ist leer. Lege Referenzen, Notizen und Farben ab, die den Look des Films festlegen.'}</p>
        <button className="btn sm" onClick={()=>story?insert('shot'):setFilter('')}><Icon name="plus"/>{story?'Erste Einstellung':'Referenz aus der Sammlung'}</button></div>}
    </section>
    {(scene||pin||card||selection==='story') && <aside className="canvas-inspector"><header><strong>{scene?'Einstellung '+(shots.indexOf(scene)+1):card?kindNames[card.type]:pin?'Referenz':'Story'}</strong>
      <button className="icon" aria-label="Details schließen" onClick={()=>select(null)}><Icon name="x"/></button></header>
      {selection==='story' && field('Story',<textarea className="text-in" rows={8} value={doc.story} onChange={e=>change(()=>({story:e.target.value}))}/>)}
      {scene && <>{editText('Titel','shots',scene,'title')}{editText('Szenenprompt','shots',scene,'prompt',true)}
        {field('Startbild',<select className="text-in" value={scene.ref} onChange={e=>edit('shots',{ref:e.target.value})}><option value="">Ohne Startbild</option>
          {[['Moodboard',images.filter(a=>mood.has(a.id))],['Projekt',images.filter(a=>!mood.has(a.id)&&pins.some(p=>p.id===a.id))],['Sonstige',images.filter(a=>a.id===scene.ref&&!mood.has(a.id)&&!pins.some(p=>p.id===a.id))]]
            .filter(([,list])=>list.length).map(([name,list])=><optgroup key={name} label={name}>{list.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</optgroup>)}</select>)}
        {field('Dauer',<select className="text-in" value={scene.duration} onChange={e=>edit('shots',{duration:Number(e.target.value)})}>{Array.from({length:27},(_,i)=><option key={i} value={i+4}>{i+4} s</option>)}</select>)}
        <div className="pg-bar"><button className="btn sm" disabled={scene===shots[0]} onClick={()=>reorder(-1)}>Früher</button><button className="btn sm" disabled={scene===shots.at(-1)} onClick={()=>reorder(1)}>Später</button></div>
        <button className="btn sm" onClick={()=>navigate('#/playground?'+new URLSearchParams({project,prompt:scene.prompt,refs:[scene.ref,...moodIds].filter(Boolean).slice(0,4).join(',')}))}>Startbild im Foto Playground erzeugen</button>
        <button className="btn primary" disabled={!scene.prompt.trim()&&!scene.ref} onClick={()=>navigate('#/video-playground?'+new URLSearchParams({project,shot:scene.id}))}>Im Video Playground vorbereiten</button></>}
      {pin && !story && <><strong>{pin.title}</strong>{safeLink(pin.source) && <a href={pin.source} target="_blank" rel="noreferrer">Quelle öffnen</a>}
        {images.some(a=>a.id===pin.id) && <button className="btn sm" onClick={createFromPin}>Als Einstellung anlegen</button>}</>}
      {card && <>{editText('Titel','cards',card,'title')}{editText(card.type==='link'?'Adresse':'Notiz','cards',card,'text',card.type!=='link')}
        {card.type==='color' && field('Farbton',<input type="color" value={card.color} onChange={e=>edit('cards',{color:e.target.value})}/>)}
        {card.type==='link' && safeLink(card.text) && <a href={card.text} target="_blank" rel="noreferrer">Link öffnen</a>}</>}
      {selection!=='story' && <div className="pg-bar"><button className={'btn sm'+(pin?'':' danger')} onClick={remove}>{pin&&!story?'Vom Board nehmen':scene?'Einstellung entfernen':'Karte entfernen'}</button>
        {pin && !story && <button className="btn sm danger" onClick={unassign}>Aus Projekt lösen</button>}</div>}
    </aside>}</div></>}
  </div>
}

function Page({ctx,board,project}) {
  const [loaded,setLoaded]=useState(null), [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    const path='/projects/'+project+'/apps/'
    Promise.all([ctx.api(path+board),ctx.api('/assets'),ctx.api('/assets?project='+project),
      board==='storyboard'?ctx.api(path+'storyboard-renders'):Promise.resolve({data:{}}),
      board==='storyboard'?ctx.api(path+'moodboard'):Promise.resolve({data:{}})])
      .then(([record,library,assigned,clips,mood])=>{
        const moodIds=Array.isArray(mood.data.items) ? mood.data.items.map(i=>i.id) : assigned.filter(a=>mood.data.positions?.[a.id]).map(a=>a.id)
        if(active)setLoaded({record,library,assigned,initialClips:clips.data,moodIds})})
      .catch(e=>{if(active)setError(e.message)})
    return ()=>{active=false}
  },[])
  return loaded?<Workspace {...{ctx,board,project,...loaded}}/>:error
    ?<p role="alert" className="canvas-note err">{error} <button className="btn sm" onClick={()=>location.reload()}>Erneut versuchen</button></p>
    :<div className="canvas-skeleton" role="status" aria-label="Board lädt"><span/><span/><span/><span/></div>
}
export function mount(container,ctx,board='storyboard') {
  const project=ctx.projects.find(p=>p.id===ctx.params.get('project')) ?? ctx.projects[0]
  if(project && !ctx.params.get('project')) history.replaceState(null,'',route(board,project.id))
  const root=createRoot(container)
  const observer=new MutationObserver(()=>{if(!container.isConnected){observer.disconnect();root.unmount()}})
  observer.observe(document.body,{childList:true,subtree:true})
  root.render(project?<Page ctx={ctx} board={board} project={project.id}/>:<p>Lege über das Plus neben „Projekte“ ein Projekt an.</p>)
}
