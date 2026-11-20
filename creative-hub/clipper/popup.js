const ext = globalThis.browser ?? globalThis.chrome
const $ = id => document.getElementById(id)

function ask(message) {
  return new Promise((resolve, reject) => {
    ext.runtime.sendMessage(message, answer => {
      if (!answer) return reject(new Error(ext.runtime.lastError?.message || 'Keine Antwort von der Erweiterung.'))
      answer.ok ? resolve(answer.result) : reject(new Error(answer.error))
    })
  })
}

function say(text, error = false) {
  $('status').textContent = text
  $('status').className = error ? 'error' : ''
}

async function start() {
  $('options').onclick = event => { event.preventDefault(); ext.runtime.openOptionsPage() }
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true })
  const { ideaId = '', lastError = '' } = await ext.storage.local.get(['ideaId', 'lastError'])
  if (lastError) say('Letzter Versuch: ' + lastError, true)
  try {
    const ideas = await ask({ type: 'ideas' })
    $('idea').append(...ideas.map(idea => new Option(idea.title, idea.id)))
    $('idea').value = ideas.some(idea => idea.id === ideaId) ? ideaId : ''
  } catch (error) { say(error.message, true) }
  $('idea').onchange = () => ext.storage.local.set({ ideaId: $('idea').value })

  $('page').onclick = async () => {
    $('page').disabled = true
    say('Sichere die Seite …')
    try { await ask({ type: 'savePage', tab }); say('Seite in Mymind gesichert.') } catch (error) { say(error.message, true) } finally { $('page').disabled = false }
  }

  if (!/^https?:/.test(tab?.url ?? '')) { $('count').textContent = '· auf dieser Seite nicht möglich'; return }
  void showPlayers(tab).catch(error=>say(error.message,true))
  let images = []
  try { images = await ask({ type: 'images', tab }) } catch (error) { say(error.message, true) }
  $('count').textContent = images.length ? '· ' + images.length : '· keine gefunden'
  $('images').replaceChildren(...images.map(image => {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = image.alt || 'Bild sichern'
    button.setAttribute('aria-label', (image.alt || 'Bild') + ' sichern')
    const img = document.createElement('img')
    img.src = image.src
    img.alt = ''
    img.referrerPolicy = 'no-referrer'
    button.append(img)
    button.onclick = async () => {
      button.classList.add('busy')
      try {
        await ask({ type: 'saveImage', src: image.src, pageUrl: tab.url, title: image.alt || tab.title })
        button.classList.add('saved')
        say('Bild in Mymind gesichert.')
      } catch (error) { say(error.message, true) } finally { button.classList.remove('busy') }
    }
    return button
  }))
}

async function showPlayers(tab) {
  const players = await ask({type:'players',tab})
  if (!players.length) return
  const select = $('players')
  select.replaceChildren(...players.map((player,index)=>{
    const label = (index+1)+'. '+(player.title || 'Video')+(player.playing ? ' · läuft' : '')
    return new Option(label,String(index))
  }))
  $('videos').hidden=false
  for (const [id,type] of [['video','saveVideo'],['frame','saveFrame']]) {
    $(id).onclick=async () => {
      $('video').disabled=$('frame').disabled=true
      say(id==='video'?'Lädt das vollständige Video …':'Sichert den aktuellen Frame …')
      try {
        await ask({type,tab,player:players[Number(select.value)]})
        say(id==='video'?'Video in der Sammlung gesichert.':'Frame in der Sammlung gesichert.')
      } catch(error) {say(error.message,true)}
      finally {$('video').disabled=$('frame').disabled=false}
    }
  }
}

start().catch(error => say(error.message, true))
