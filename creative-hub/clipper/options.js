const form = document.querySelector('form')
const output = document.querySelector('[role="status"]')
chrome.storage.sync.get('hubUrl').then(({ hubUrl }) => { form.elements.hubUrl.value = hubUrl || '' })
form.addEventListener('submit', async event => {
  event.preventDefault()
  const url = new URL(form.elements.hubUrl.value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    output.textContent = 'Gib eine HTTP- oder HTTPS-Adresse ein.'
    return
  }
  await chrome.storage.sync.set({ hubUrl: url.origin })
  output.textContent = 'Adresse gespeichert. Öffne auf einer Webseite das Kontextmenü.'
})
