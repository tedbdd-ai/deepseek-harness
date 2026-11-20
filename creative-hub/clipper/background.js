// Atelier Clipper: saves images, pages, selections and links straight into Mymind (library "clips").
// Requests go to the hub's token route `/creativity-launcher/api/`. In Safari the token comes from the
// containing app (native message; the app reads ~/.creativity-hub/launcher-token), elsewhere from the
// options page. The popup reaches everything here through runtime messages.
const ext = globalThis.browser ?? globalThis.chrome
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const maxBytes = 12 * 1024 * 1024
let nativeToken = ''

const menus = [
  ['atelier-frame', 'Aktuellen Videoframe ins Atelier', ['video']],
  ['atelier-video', 'Ganzes Video ins Atelier', ['video']],
  ['atelier-image', 'Bild ins Atelier', ['image']],
  ['atelier-page', 'Seite ins Atelier (Screenshot)', ['page']],
  ['atelier-selection', 'Auswahl ins Atelier', ['selection']],
  ['atelier-link', 'Link ins Atelier', ['link']],
]

ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.removeAll(() => {
    for (const [id, title, contexts] of menus) ext.contextMenus.create({ id, title, contexts })
  })
})

/** The hub token: typed into the options, else read by the Safari app. */
async function token(typed) {
  if (typed) return typed
  if (nativeToken) return nativeToken
  try {
    const answer = await ext.runtime.sendNativeMessage('local.atelier.clipper', { type: 'token' })
    nativeToken = typeof answer?.token === 'string' ? answer.token.trim() : ''
    if (!nativeToken && answer?.error) throw new Error(answer.error)
  } catch (error) {
    throw new Error('Kein Hub-Schlüssel. ' + (error.message || '') + ' Trag ihn in den Einstellungen der Erweiterung ein.')
  }
  if (!nativeToken) throw new Error('Kein Hub-Schlüssel. Starte den Hub einmal, er legt ~/.creativity-hub/launcher-token an.')
  return nativeToken
}

async function hubFetch(path, method = 'GET', body, destination) {
  const settings = destination ?? await ext.storage.local.get(['port','token'])
  const port = settings.port ?? 3080
  const key = await token(settings.token)
  const binary = body instanceof Blob
  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}/creativity-launcher/api/${path}`, {
      method, redirect: 'error',
      headers: { Authorization: 'Bearer ' + key, ...(body && { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }) },
      ...(body && { body: binary ? body : JSON.stringify(body) }),
    })
  } catch {
    throw new Error(`Der Hub antwortet nicht auf Port ${port}. Läuft start.command?`)
  }
  const result = await response.json().catch(() => ({}))
  if (response.status === 401) nativeToken = ''
  if (!response.ok) throw new Error(result.error || `Der Hub meldet HTTP ${response.status}.`)
  return result
}

function base64(buffer) {
  const bytes = new Uint8Array(buffer)
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

/** Downloads an image; formats the hub does not store (AVIF, SVG, …) are converted to PNG. */
async function imagePayload(src) {
  if (!/^(https?|data):/i.test(src ?? '')) throw new Error('Dieses Bild hat keine ladbare Adresse.')
  const response = await fetch(src, { credentials: 'include' }).catch(() => null)
  if (!response?.ok) throw new Error('Das Bild ließ sich nicht laden.')
  let blob = await response.blob()
  if (!allowedTypes.includes(blob.type)) {
    try {
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d').drawImage(bitmap, 0, 0)
      blob = await canvas.convertToBlob({ type: 'image/png' })
    } catch {
      throw new Error(`Das Format ${blob.type || 'unbekannt'} kann ich nicht umwandeln.`)
    }
  }
  if (blob.size > maxBytes) throw new Error('Das Bild ist größer als 12 MB.')
  return { media: base64(await blob.arrayBuffer()), mediaType: blob.type }
}

/** Title, description, og:image and selection of the page, read in the tab. */
async function pageInfo(tabId) {
  const [result] = await ext.scripting.executeScript({
    target: { tabId },
    func: () => {
      const meta = key => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content || ''
      let image = ''
      try { image = meta('og:image') ? new URL(meta('og:image'), location.href).href : '' } catch { image = '' }
      return { title: meta('og:title') || document.title, description: meta('og:description') || meta('description'), image, selection: String(getSelection() || '') }
    },
  })
  return result?.result ?? {}
}

/** Images of the page at least 120 px wide or tall, og:image first, without duplicates. */
async function pageImages(tabId) {
  const [result] = await ext.scripting.executeScript({
    target: { tabId },
    func: () => {
      const found = new Map()
      const add = (src, width, height, alt) => { if (src && /^(https?|data):/.test(src) && !found.has(src)) found.set(src, { src, width, height, alt }) }
      const og = document.querySelector('meta[property="og:image"]')?.content
      if (og) try { add(new URL(og, location.href).href, 0, 0, 'Vorschaubild der Seite') } catch {}
      for (const img of document.images) if (Math.max(img.naturalWidth, img.naturalHeight) >= 120) add(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight, img.alt)
      return [...found.values()].slice(0, 120)
    },
  })
  return result?.result ?? []
}

async function target() {
  const { ideaId = '' } = await ext.storage.local.get('ideaId')
  return ideaId ? { projectId: ideaId } : {}
}

const hostOf = url => { try { return new URL(url).hostname } catch { return '' } }
const httpOnly = url => (/^https?:\/\//i.test(url ?? '') ? url.slice(0, 4096) : '')

async function saveImage(src, pageUrl, title) {
  return hubFetch('assets', 'POST', {
    library: 'clips', title: (title || hostOf(pageUrl) || 'Bild').slice(0, 200),
    source: httpOnly(pageUrl), preview: httpOnly(src), ...(await imagePayload(src)), ...(await target()),
  })
}

async function savePage(tab) {
  const info = await pageInfo(tab.id).catch(() => ({}))
  const shot = await ext.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 })
  return hubFetch('assets', 'POST', {
    library: 'clips', title: (info.title || tab.title || hostOf(tab.url) || 'Seite').slice(0, 200),
    source: httpOnly(tab.url), preview: httpOnly(info.image),
    description: (info.selection || info.description || '').slice(0, 4000),
    media: shot.split(',')[1], mediaType: 'image/jpeg', ...(await target()),
  })
}

async function saveText(tab, text) {
  return hubFetch('assets', 'POST', { library: 'clips', title: (tab.title || text).slice(0, 200), source: httpOnly(tab.url), description: text.slice(0, 4000), ...(await target()) })
}

async function saveLink(url, text) {
  return hubFetch('assets', 'POST', { library: 'clips', title: (text || hostOf(url) || url).slice(0, 200), source: httpOnly(url), ...(await target()) })
}

// Executed in the isolated world of each frame. Tokens identify DOM players even
// when several of them share the same URL or the page reorders its elements.
function inspectPlayers(action, selector) {
  const keys = globalThis.__atelierVideoKeys ??= new WeakMap()
  const videos = [...document.querySelectorAll('video')]
  function info(video) {
    if (!keys.has(video)) keys.set(video, crypto.randomUUID?.() ?? String(Math.random()))
    return { key:keys.get(video), src:video.currentSrc || video.src, time:video.currentTime,
      title:video.getAttribute('aria-label') || video.title || document.title,
      playing:!video.paused && !video.ended, ready:video.readyState >= 2 }
  }
  if (action === 'list') return videos.map(info)
  const matches = videos.filter(v=>selector.key ? keys.get(v) === selector.key :
    !selector.src || (v.currentSrc || v.src) === selector.src)
  const video = matches.find(v=>v.matches(':hover')) ?? (matches.length===1 ? matches[0] : null)
  if (!video) return {error:'Der Player hat gewechselt. Öffne den Clipper erneut.'}
  const item = info(video)
  if (video.mediaKeys) return {error:'Dieser Player verwendet geschützte Medien.'}
  if (action === 'video') return item
  if (!item.ready || !video.videoWidth) return {error:'Starte das Video, bis ein Bild sichtbar ist.'}
  const canvas = document.createElement('canvas')
  const scale = Math.min(1,4096/Math.max(video.videoWidth,video.videoHeight))
  canvas.width = Math.max(1,Math.round(video.videoWidth*scale))
  canvas.height = Math.max(1,Math.round(video.videoHeight*scale))
  try {
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height)
    return {...item, image:canvas.toDataURL('image/jpeg',0.94)}
  } catch (e) {
    if (e.name !== 'SecurityError') return {error:'Der Videoframe konnte nicht gelesen werden.'}
    const rect=video.getBoundingClientRect()
    return {...item,rect:{x:rect.x,y:rect.y,w:rect.width,h:rect.height}}
  }
}

// Each document supplies geometry in its own viewport. The child index path
// connects nested players to the top viewport without reading a foreign DOM.
function frameGeometry() {
  const path=[]
  for (let child=window; child!==child.parent; child=child.parent) {
    const parent=child.parent
    let index=0
    while (index<parent.length && parent[index]!==child) index++
    path.unshift(index)
  }
  const children={}
  for (const frame of document.querySelectorAll('iframe,frame')) {
    let index=0
    while(index<frames.length && frames[index]!==frame.contentWindow) index++
    const r=frame.getBoundingClientRect()
    const sx=r.width/(frame.offsetWidth||1), sy=r.height/(frame.offsetHeight||1)
    children[index]={x:r.x+frame.clientLeft*sx,y:r.y+frame.clientTop*sy,w:frame.clientWidth*sx,h:frame.clientHeight*sy}
  }
  return {path,children,w:innerWidth,h:innerHeight}
}

async function visibleFrame(tab,frameId,rect) {
  const active = async () => (await ext.tabs.query({active:true,windowId:tab.windowId}))[0]?.id===tab.id
  if (!await active()) throw new Error('Öffne den Videotab im Vordergrund.')
  const frames=await ext.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:frameGeometry})
  let frame=frames.find(f=>f.frameId===frameId)?.result
  while(frame) {
    const x=Math.max(0,rect.x), y=Math.max(0,rect.y)
    rect={x,y,w:Math.min(frame.w,rect.x+rect.w)-x,h:Math.min(frame.h,rect.y+rect.h)-y}
    if(rect.w<1 || rect.h<1) throw new Error('Scrolle den Player in den sichtbaren Bereich.')
    if(!frame.path.length) break
    const parent=frames.find(f=>String(f.result?.path)===String(frame.path.slice(0,-1)))?.result
    const box=parent?.children[frame.path.at(-1)]
    if(!box) throw new Error('Der eingebettete Player lässt sich nicht als sichtbarer Bereich erfassen.')
    rect={x:box.x+rect.x*box.w/frame.w,y:box.y+rect.y*box.h/frame.h,w:rect.w*box.w/frame.w,h:rect.h*box.h/frame.h}
    frame=parent
  }
  if(!frame) throw new Error('Der Player ist nicht mehr sichtbar.')
  const screenshot=await ext.tabs.captureVisibleTab(tab.windowId,{format:'png'})
  if(!await active()) throw new Error('Der aktive Tab hat gewechselt.')
  const bitmap=await createImageBitmap(await (await fetch(screenshot)).blob())
  try {
    const x=bitmap.width/frame.w,y=bitmap.height/frame.h
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(rect.w*x)),Math.max(1,Math.round(rect.h*y)))
    canvas.getContext('2d').drawImage(bitmap,rect.x*x,rect.y*y,rect.w*x,rect.h*y,0,0,canvas.width,canvas.height)
    return base64(await (await canvas.convertToBlob({type:'image/jpeg',quality:.94})).arrayBuffer())
  } finally { bitmap.close() }
}

async function videoFile(src) {
  if (!/^https?:\/\//i.test(src) || /\.(m3u8|mpd)(?:[?#]|$)/i.test(src)) throw new Error('Dieser Player liefert einen Stream ohne direkte Videodatei. Du kannst einen Frame sichern.')
  const limit=80*1024*1024
  const response=await fetch(src,{credentials:'include'})
  if (!response.ok || response.status===206 || !response.body) throw new Error('Die vollständige Videodatei ist nicht abrufbar.')
  const reader=response.body.getReader()
  let size=0
  const parts=[]
  try {
    if (Number(response.headers.get('Content-Length'))>limit) throw new Error('Das Video ist größer als 80 MiB.')
    for (;;) {
      const {done,value}=await reader.read()
      if(done) break
      size+=value.length
      if(size>limit) throw new Error('Das Video ist größer als 80 MiB.')
      parts.push(value)
    }
  } finally { await reader.cancel().catch(()=>{}) }
  return new Blob(parts,{type:'application/octet-stream'})
}

async function savePlayer(tab,player,action) {
  const destination = await ext.storage.local.get(['port','token','ideaId'])
  const [frame]=await ext.scripting.executeScript({target:{tabId:tab.id,frameIds:[player.frameId]},func:inspectPlayers,args:[action,player]})
  const item=frame?.result
  if(!item || item.error) throw new Error(item?.error || 'Der Player ist nicht erreichbar.')
  const metadata={title:(item.title||tab.title||'Video').slice(0,160),source:httpOnly(tab.url),projectId:destination.ideaId || ''}
  if(action==='video') return hubFetch('clips/video?'+new URLSearchParams(metadata),'POST',await videoFile(item.src),destination)
  const media=item.image?.split(',')[1] ?? await visibleFrame(tab,player.frameId,item.rect)
  return hubFetch('assets','POST',{...metadata,library:'clips',title:metadata.title+' · '+item.time.toFixed(2)+' s',media,mediaType:'image/jpeg'},destination)
}

function setBadge(text, color) {
  ext.action.setBadgeBackgroundColor?.({ color })
  ext.action.setBadgeText({ text })
  setTimeout(() => ext.action.setBadgeText({ text: '' }), 2500)
}

/** Runs a context-menu save and reports it on the toolbar badge; the popup shows the last error. */
async function report(work) {
  try {
    await work()
    await ext.storage.local.set({ lastError: '' })
    setBadge('✓', '#22C55E')
  } catch (error) {
    await ext.storage.local.set({ lastError: error.message })
    setBadge('!', '#EF4444')
  }
}

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return
  if (['atelier-video','atelier-frame'].includes(info.menuItemId)) report(() => savePlayer(tab,{frameId:info.frameId ?? 0,src:info.srcUrl},info.menuItemId === 'atelier-video' ? 'video' : 'frame'))
  if (info.menuItemId === 'atelier-image') report(() => saveImage(info.srcUrl, info.pageUrl || tab.url, tab.title))
  if (info.menuItemId === 'atelier-page') report(() => savePage(tab))
  if (info.menuItemId === 'atelier-selection') report(() => saveText(tab, info.selectionText || ''))
  if (info.menuItemId === 'atelier-link') report(() => saveLink(info.linkUrl, info.linkText || info.selectionText))
})

ext.runtime.onMessage.addListener((message, sender, reply) => {
  const run = async () => {
    switch (message.type) {
      case 'players': {
        const frames=await ext.scripting.executeScript({target:{tabId:message.tab.id,allFrames:true},func:inspectPlayers,args:['list',{}]})
        return frames.flatMap(frame=>(frame.result ?? []).map(player=>({...player,frameId:frame.frameId}))).sort((a,b)=>Number(b.playing)-Number(a.playing))
      }
      case 'saveVideo': return savePlayer(message.tab,message.player,'video')
      case 'saveFrame': return savePlayer(message.tab,message.player,'frame')
      case 'ideas': return hubFetch('projects')
      case 'images': return pageImages(message.tab.id)
      case 'savePage': return savePage(message.tab)
      case 'saveImage': return saveImage(message.src, message.pageUrl, message.title)
      case 'ping': return hubFetch('projects').then(list => ({ ideas: list.length }))
      default: throw new Error('Unbekannte Aktion.')
    }
  }
  run().then(result => reply({ ok: true, result }), error => reply({ ok: false, error: error.message }))
  return true
})
