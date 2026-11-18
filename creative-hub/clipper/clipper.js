chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'hub-save', title: 'Im Creativity Hub speichern', contexts: ['page', 'image', 'selection'] })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'hub-save' || !tab?.id) return
  const { hubUrl } = await chrome.storage.sync.get('hubUrl')
  if (!hubUrl) {
    await chrome.runtime.openOptionsPage()
    return
  }
  let metadata = {}
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const meta = key => document.querySelector('meta[property="' + key + '"],meta[name="' + key + '"]')?.content || ''
        const image = meta('og:image')
        let preview = ''
        try { if (image) preview = new URL(image, location.href).href } catch {}
        return {
          title: meta('og:title') || document.title,
          description: meta('og:description') || meta('description'),
          preview,
        }
      },
    })
    metadata = result.result ?? {}
  } catch {
    // Some browser pages deny script injection. The tab still provides its title and URL.
  }
  const source = info.pageUrl || tab.url || ''
  if (!/^https?:\/\//i.test(source)) return
  const clip = {
    title: (metadata.title || tab.title || source).slice(0, 200),
    description: (info.selectionText || metadata.description || '').slice(0, 2000),
    source: source.slice(0, 4096),
    preview: (info.srcUrl || metadata.preview || '').slice(0, 4096),
  }
  const destination = new URL('/creativity-hub', hubUrl)
  destination.hash = 'clip=' + encodeURIComponent(JSON.stringify(clip))
  await chrome.tabs.create({ url: destination.href })
})
