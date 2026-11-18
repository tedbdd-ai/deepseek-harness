const ext = globalThis.browser ?? globalThis.chrome
const form = document.querySelector('form')
const output = document.getElementById('status')

ext.storage.local.get(['port', 'token']).then(({ port = 3080, token = '' }) => {
  form.elements.port.value = port
  form.elements.token.placeholder = token ? 'gesetzt – zum Ändern neu eingeben' : 'leer lassen in Safari'
})

form.addEventListener('submit', async event => {
  event.preventDefault()
  const port = Number(form.elements.port.value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) { output.textContent = 'Gib einen gültigen Port ein.'; return }
  await ext.storage.local.set({ port, ...(form.elements.token.value.trim() && { token: form.elements.token.value.trim() }) })
  form.elements.token.value = ''
  output.textContent = 'Prüfe …'
  ext.runtime.sendMessage({ type: 'ping' }, answer => {
    output.textContent = answer?.ok ? `Verbunden. Der Hub kennt ${answer.result.ideas} Ideen.` : 'Keine Verbindung: ' + (answer?.error || ext.runtime.lastError?.message || 'unbekannt')
  })
})
