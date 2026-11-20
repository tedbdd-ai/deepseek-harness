/**
 * Shared tag building blocks of the Atelier client: filter bar, tag editor, bulk tagging,
 * tag manager and sort mode. `app.js` hands in its helpers; nothing here talks to the DOM
 * outside the elements it creates.
 */

const FILTER_KEYS = ['tags', 'colors', 'rating', 'untagged', 'suggestions', 'run', 'sort']
const swatches = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0091ff', '#6e56cf', '#e93d82', '#f2f2f0', '#8b8d98', '#111112']

/**
 * @param {{ el: Function, icon: (name: string) => Element, api: Function, toast: Function, state: object,
 *   confirmDialog: Function, mediaUrl: (item: object) => string, media: Function, emptyState: Function,
 *   errorState: Function, header: Function, loading: Function, view: Element, openItem: (item: object) => void }} h
 */
export function createTags(h) {
  const { el, icon, api, toast, state, confirmDialog, view } = h
  const names = new Map()
  /** `replaceChildren` that skips empty slots (it would print `null`). */
  const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter(kid => kid !== null && kid !== undefined && kid !== false))
  let vocabulary = []

  async function loadVocabulary() {
    vocabulary = await api('/tags')
    names.clear()
    for (const facet of vocabulary) for (const tag of facet.tags) names.set(tag.id, { ...tag, facet: facet.id })
    return vocabulary
  }
  const facetName = id => vocabulary.find(facet => facet.id === id)?.name ?? id
  const tagName = id => names.get(id)?.name ?? id.split(':').pop()

  /* Filter in der URL: #/library?tags=mode:latex,licht:neon&rating=1 */
  function readFilters() {
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
    return {
      tags: new Set((params.get('tags') ?? '').split(',').filter(Boolean)),
      colors: (params.get('colors') ?? '').split(',').filter(Boolean),
      rating: params.get('rating') ?? '', untagged: params.has('untagged'), suggestions: params.has('suggestions'),
      run: params.get('run') ?? '', sort: params.get('sort') ?? '',
    }
  }
  function writeFilters(filters) {
    const path = location.hash.split('?')[0]
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
    for (const key of FILTER_KEYS) params.delete(key)
    if (filters.tags.size) params.set('tags', [...filters.tags].join(','))
    if (filters.colors.length) params.set('colors', filters.colors.join(','))
    if (filters.rating) params.set('rating', filters.rating)
    if (filters.untagged) params.set('untagged', '1')
    if (filters.suggestions) params.set('suggestions', '1')
    if (filters.run) params.set('run', filters.run)
    if (filters.sort) params.set('sort', filters.sort)
    const query = params.toString()
    history.replaceState(null, '', path + (query ? '?' + query : ''))
  }
  const isActive = filters => filters.tags.size || filters.colors.length || filters.rating || filters.untagged || filters.suggestions || filters.run
  function searchParams(filters, extra = {}) {
    const params = new URLSearchParams()
    if (state.query) params.set('q', state.query)
    if (filters.tags.size) params.set('tags', [...filters.tags].join(','))
    if (filters.colors.length) params.set('colors', filters.colors.join(','))
    if (filters.rating) params.set('rating', filters.rating)
    if (filters.untagged) params.set('untagged', '1')
    if (filters.suggestions) params.set('suggestions', '1')
    if (filters.run) params.set('run', filters.run)
    if (filters.sort) params.set('sort', filters.sort)
    for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') params.set(key, value)
    return params
  }

  const chip = (label, onRemove, extra) => el('button', { type: 'button', class: 'chip filter-chip', 'aria-label': `${label} als Filter entfernen`, onclick: onRemove },
    extra, label, icon('close'))

  /**
   * Filter bar over a search result. Call `update(result)` after every search to refresh counts and chips.
   * @param {{ filters: object, onChange: () => void }} options `filters` is mutated in place; `onChange` reloads the list.
   */
  function filterBar({ filters, onChange, onSave }) {
    let facets = {}, chips = [], total = 0, open = ''
    const root = el('div', { class: 'filterbar' })
    const changed = () => { writeFilters(filters); onChange() }
    const toggleTag = id => { filters.tags.has(id) ? filters.tags.delete(id) : filters.tags.add(id); changed() }

    function popover(facet) {
      const options = vocabulary.find(item => item.id === facet.id)?.tags ?? []
      const counts = new Map((facets[facet.id] ?? []).map(entry => [entry.tagId, entry.count]))
      const input = el('input', { class: 'text-in', type: 'search', placeholder: facet.name + ' suchen', 'aria-label': facet.name + ' suchen', autocomplete: 'off' })
      const list = el('div', { class: 'pop-list', role: 'listbox', 'aria-multiselectable': 'true' })
      const draw = () => {
        const query = input.value.trim().toLocaleLowerCase('de-DE')
        const visible = options.filter(tag => (counts.get(tag.id) || filters.tags.has(tag.id)) &&
          (!query || (tag.name + ' ' + tag.aliases.join(' ')).toLocaleLowerCase('de-DE').includes(query)))
          .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'de'))
        list.replaceChildren(...(visible.length ? visible.map(tag => el('button', { type: 'button', class: 'pop-item', role: 'option',
          'aria-selected': String(filters.tags.has(tag.id)), onclick: () => toggleTag(tag.id) },
        el('span', { class: 'box' }, filters.tags.has(tag.id) ? icon('check') : null), el('span', { class: 't' }, tag.name),
        el('span', { class: 'n' }, counts.get(tag.id) ?? 0))) : [el('p', { class: 'meta pop-empty' }, query ? 'Nichts passt zu deiner Eingabe.' : 'In diesem Ergebnis kommt hier nichts vor.')]))
      }
      input.addEventListener('input', draw)
      draw()
      return el('div', { class: 'pop', role: 'dialog', 'aria-label': facet.name }, input, list)
    }

    function colorPop() {
      return el('div', { class: 'pop pop-colors', role: 'dialog', 'aria-label': 'Farbe' }, el('div', { class: 'swatches' }, swatches.map(hex =>
        el('button', { type: 'button', class: 'swatch', 'aria-label': 'Farbe ' + hex, 'aria-pressed': String(filters.colors.includes(hex)), style: `background:${hex}`,
          onclick: () => { filters.colors = filters.colors.includes(hex) ? filters.colors.filter(c => c !== hex) : [...filters.colors, hex]; changed() } }))))
    }

    function draw() {
      const editable = vocabulary.filter(facet => facet.id !== 'frei' || facet.tags.length)
      const pills = editable.filter(facet => facet.id !== 'farbe' && (facets[facet.id]?.length || facet.tags.some(tag => filters.tags.has(tag.id)))).map(facet => {
        const selected = facet.tags.filter(tag => filters.tags.has(tag.id)).length
        const wrap = el('div', { class: 'pop-wrap' }, el('button', { type: 'button', class: 'pill facet-pill' + (selected ? ' on' : ''), 'aria-expanded': String(open === facet.id), 'aria-haspopup': 'dialog',
          onclick: () => { open = open === facet.id ? '' : facet.id; draw() } }, facet.name, selected ? el('span', { class: 'n' }, selected) : null, icon('chev-down')))
        if (open === facet.id) wrap.append(popover(facet))
        return wrap
      })
      const color = el('div', { class: 'pop-wrap' }, el('button', { type: 'button', class: 'pill facet-pill' + (filters.colors.length ? ' on' : ''), 'aria-expanded': String(open === 'farbe'), 'aria-haspopup': 'dialog',
        onclick: () => { open = open === 'farbe' ? '' : 'farbe'; draw() } }, 'Farbe', filters.colors.length ? el('span', { class: 'n' }, filters.colors.length) : null, icon('chev-down')))
      if (open === 'farbe') color.append(colorPop())
      const toggle = (label, key, value = '1') => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filters[key] === (value === '1' && typeof filters[key] === 'boolean' ? true : value)),
        onclick: () => { filters[key] = typeof filters[key] === 'boolean' ? !filters[key] : filters[key] === value ? '' : value; changed() } }, label)
      const active = [
        ...[...filters.tags].map(id => chip(`${tagName(id)} · ${facetName(names.get(id)?.facet ?? id.split(':')[0])}`, () => toggleTag(id))),
        ...filters.colors.map(hex => chip(hex, () => { filters.colors = filters.colors.filter(c => c !== hex); changed() }, el('span', { class: 'swatch-dot', style: `background:${hex}` }))),
        ...chips.filter(entry => !filters.tags.has(entry.tagId)).map(entry => el('span', { class: 'chip detected', title: 'Aus deiner Suche erkannt' }, `${tagName(entry.tagId)} · ${facetName(names.get(entry.tagId)?.facet ?? '')}`)),
        filters.run ? chip('Stapel', () => { filters.run = ''; changed() }, icon('layers')) : null,
      ].filter(Boolean)
      put(root,
        el('div', { class: 'filterbar-row' }, ...pills, color,
          el('span', { class: 'sep', 'aria-hidden': 'true' }),
          toggle('Favoriten', 'rating', '1'), toggle('Offene Vorschläge', 'suggestions'), toggle('Ohne Tags', 'untagged'),
          toggle('Aussortierte', 'rating', '-1'),
          onSave && (isActive(filters) || state.query) ? el('button', { type: 'button', class: 'btn sm ghost', onclick: onSave }, icon('plus'), 'Suche speichern') : null,
          el('span', { class: 'meta count', role: 'status' }, total === 1 ? '1 Treffer' : `${total} Treffer`)),
        active.length || isActive(filters) ? el('div', { class: 'filterbar-row' }, ...active,
          el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { filters.tags.clear(); filters.colors = []; filters.rating = ''; filters.untagged = false; filters.suggestions = false; filters.run = ''; changed() } }, 'Alle Filter entfernen')) : null)
    }
    const outside = event => {
      if (!root.isConnected) return document.removeEventListener('click', outside)
      // A click on a control that a redraw already replaced is not an outside click.
      if (open && event.target.isConnected && !root.contains(event.target)) { open = ''; draw() }
    }
    document.addEventListener('click', outside)
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); const was = open; open = ''; draw(); root.querySelector(`.facet-pill[aria-expanded="false"]`)?.focus?.(); void was }
    })
    return { el: root, update(result) { facets = result.facets; chips = result.chips; total = result.total; draw() } }
  }

  /** Chips of one asset grouped by facet with accept / reject for suggestions, plus an input with completion. */
  function tagEditor(item, { onChange = () => {} } = {}) {
    const root = el('section', { class: 'field tag-editor', 'data-asset': item.id }, el('span', {}, 'Tags'), el('div', { class: 'skel', style: 'height:48px' }))
    async function load() {
      try {
        const [tags, analysis] = await Promise.all([api('/assets/tags?ids=' + item.id), api(`/assets/${item.id}/analysis`).catch(() => null)])
        if (root.isConnected || !root.parentNode) draw(tags[item.id] ?? [], analysis)
      } catch (error) {
        root.replaceChildren(el('span', {}, 'Tags'), el('p', { class: 'meta', role: 'alert' }, error.message), el('button', { type: 'button', class: 'btn sm', onclick: load }, 'Erneut versuchen'))
      }
    }
    async function decide(tagIds, state) {
      try { await api('/assets/tag-state', 'POST', { assetIds: [item.id], tagIds, state }); await load(); onChange() } catch (error) { toast(error.message, true) }
    }
    function draw(tags, analysis) {
      const groups = vocabulary.map(facet => [facet, tags.filter(tag => tag.facet === facet.id)]).filter(([, list]) => list.length)
      const input = el('input', { class: 'text-in', placeholder: 'Tag hinzufügen', 'aria-label': 'Tag hinzufügen', list: 'tag-options-' + item.id, autocomplete: 'off' })
      const options = el('datalist', { id: 'tag-options-' + item.id }, vocabulary.filter(facet => facet.editable).flatMap(facet => facet.tags.flatMap(tag => [tag.name, ...tag.aliases].map(label => el('option', { value: label })))))
      const message = el('p', { class: 'meta', role: 'status' })
      const create = el('div', { class: 'row', hidden: true })
      async function submit(event) {
        event.preventDefault()
        const text = input.value.trim()
        if (!text) return
        const known = [...names.values()].find(tag => (tag.name + ',' + tag.aliases.join(',')).toLocaleLowerCase('de-DE').split(',').includes(text.toLocaleLowerCase('de-DE')))
        if (known) { input.value = ''; return decide([known.id], 'bestaetigt') }
        const facet = el('select', { class: 'text-in', 'aria-label': 'Gruppe' }, vocabulary.filter(entry => entry.editable).map(entry => el('option', { value: entry.id, selected: entry.id === 'frei' ? true : null }, entry.name)))
        create.replaceChildren(el('span', { class: 'meta' }, `„${text}“ neu anlegen in`), facet, el('button', { type: 'button', class: 'btn sm primary', onclick: async () => {
          try {
            const tag = await api('/tags', 'POST', { facet: facet.value, name: text })
            await loadVocabulary(); input.value = ''; await decide([tag.id], 'bestaetigt')
          } catch (error) { message.textContent = error.message }
        } }, 'Anlegen'))
        create.hidden = false
      }
      const form = el('form', { class: 'tag-input', onsubmit: submit }, input, options)
      put(root, el('span', {}, 'Tags'),
        groups.length ? el('div', { class: 'tag-groups' }, groups.map(([facet, list]) => el('div', { class: 'tag-group' }, el('small', { class: 'meta' }, facet.name),
          el('div', { class: 'chips' }, list.map(tag => tag.state === 'vorschlag'
            ? el('span', { class: 'tag-chip sug', title: `Vorschlag, ${{ vision: 'von Apple Vision', text: 'aus dem Text', meta: 'aus den Referenzen', ki: 'von der KI', nutzer: 'von dir' }[tag.origin]}${tag.confidence ? ', ' + Math.round(tag.confidence * 100) + ' %' : ''}` },
              tag.name, el('button', { type: 'button', class: 'mini', 'aria-label': `${tag.name} übernehmen`, onclick: () => decide([tag.tagId], 'bestaetigt') }, icon('check')),
              el('button', { type: 'button', class: 'mini', 'aria-label': `${tag.name} ablehnen`, onclick: () => decide([tag.tagId], 'abgelehnt') }, icon('close')))
            : el('span', { class: 'tag-chip' }, tag.name, facet.editable ? el('button', { type: 'button', class: 'mini', 'aria-label': `${tag.name} entfernen`, onclick: () => decide([tag.tagId], 'entfernt') }, icon('close')) : null)))))) :
          el('p', { class: 'meta' }, 'Noch keine Tags. Die Analyse läuft im Hintergrund oder du fügst eigene hinzu.'),
        form, create, message,
        analysis?.colors?.length ? el('div', { class: 'field' }, el('span', {}, 'Farben'), el('div', { class: 'swatches' }, analysis.colors.map(color =>
          el('a', { class: 'swatch', href: '#/library?colors=' + encodeURIComponent(color.hex), title: `${color.hex} · ${Math.round(color.share * 100)} %`, 'aria-label': 'Nach Farbe ' + color.hex + ' suchen', style: `background:${color.hex}` })))) : null,
        analysis?.featureprint ? el('button', { type: 'button', class: 'btn sm', onclick: () => similarDialog(item) }, icon('search'), 'Ähnliche finden') : null)
    }
    void load()
    return root
  }

  async function similarDialog(item) {
    const body = el('div', { class: 'similar-grid', 'aria-busy': 'true' })
    const dialog = el('dialog', { class: 'wide', 'aria-label': 'Ähnliche Bilder' }, el('form', { method: 'dialog' }, el('h2', {}, `Ähnlich zu „${item.title.length > 48 ? item.title.slice(0, 48) + '…' : item.title}“`), body,
      el('div', { class: 'row' }, el('button', { class: 'btn' }, 'Schließen'))))
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
    document.body.append(dialog)
    dialog.showModal()
    try {
      const hits = await api(`/assets/${item.id}/similar?limit=24`)
      body.removeAttribute('aria-busy')
      body.replaceChildren(...(hits.length ? hits.map(hit => el('button', { type: 'button', class: 'similar-item', title: hit.title, onclick: () => { dialog.close(); h.openItem(hit) } },
        h.media(hit), el('small', { class: 'meta' }, hit.distance < 0.6 ? 'fast gleich' : 'ähnlich'))) : [el('p', { class: 'meta' }, 'Keine ähnlichen Bilder gefunden. Die Analyse braucht ein paar Minuten für alle Bilder.')]))
    } catch (error) { body.replaceChildren(el('p', { role: 'alert' }, error.message), el('button', { type: 'button', class: 'btn', onclick: () => { dialog.close(); similarDialog(item) } }, 'Erneut versuchen')) }
  }

  /** Dialog for a selection: tri-state tags (all / some / none), accept suggestions. */
  async function bulkDialog(ids, after) {
    const dialog = el('dialog', { class: 'wide', 'aria-label': 'Tags der Auswahl' })
    const list = el('div', { class: 'bulk-list', 'aria-busy': 'true' })
    const filter = el('input', { class: 'text-in', type: 'search', placeholder: 'Tags suchen', 'aria-label': 'Tags suchen', autocomplete: 'off' })
    let have = new Map(), suggested = 0
    async function load() {
      const map = await api('/assets/tags?ids=' + ids.join(','))
      have = new Map(); suggested = 0
      for (const tags of Object.values(map)) for (const tag of tags) {
        if (tag.state === 'bestaetigt') have.set(tag.tagId, (have.get(tag.tagId) ?? 0) + 1)
        else suggested++
      }
      draw()
    }
    function draw() {
      list.removeAttribute('aria-busy')
      const query = filter.value.trim().toLocaleLowerCase('de-DE')
      const sections = vocabulary.filter(facet => facet.editable && facet.tags.length).map(facet => {
        const tags = facet.tags.filter(tag => !query || (tag.name + ' ' + tag.aliases.join(' ')).toLocaleLowerCase('de-DE').includes(query))
        return tags.length ? el('div', { class: 'tag-group' }, el('small', { class: 'meta' }, facet.name), el('div', { class: 'chips' }, tags.map(tag => {
          const n = have.get(tag.id) ?? 0
          const mode = n === 0 ? 'false' : n === ids.length ? 'true' : 'mixed'
          return el('button', { type: 'button', class: 'chip tri', 'aria-pressed': mode, title: mode === 'mixed' ? `${n} von ${ids.length}` : '',
            onclick: async event => {
              try {
                const remove = mode === 'true' || event.altKey
                await api('/assets/tag-state', 'POST', { assetIds: ids, tagIds: [tag.id], state: remove ? 'entfernt' : 'bestaetigt' })
                await load()
              } catch (error) { toast(error.message, true) }
            } }, mode === 'mixed' ? el('span', { class: 'mixed', 'aria-hidden': 'true' }) : null, tag.name, mode === 'mixed' ? el('span', { class: 'n' }, n) : null)
        }))) : null
      }).filter(Boolean)
      list.replaceChildren(...(sections.length ? sections : [el('p', { class: 'meta' }, 'Nichts passt zu deiner Eingabe.')]))
    }
    filter.addEventListener('input', draw)
    const accept = el('button', { type: 'button', class: 'btn', onclick: async () => {
      try { await api('/assets/accept-suggestions', 'POST', { ids }); toast('Vorschläge übernommen.'); await load() } catch (error) { toast(error.message, true) }
    } }, icon('check'), 'Vorschläge übernehmen')
    const ai = el('button', { type: 'button', class: 'btn', disabled: true }, icon('wand'), 'Mit KI verschlagworten', el('span', { class: 'kbd' }, 'kostenpflichtig'))
    const aiNote = el('p', { class: 'meta', role: 'status' })
    api('/providers').then(list => {
      const provider = list.find(item => item.capabilities.includes('chat') && item.chatImages && item.secrets.every(secret => secret.configured))
      if (!provider) { aiNote.replaceChildren('Für KI-Tags fehlt ein Textanbieter mit Bildeingabe. ', el('a', { href: '#/anbieter', onclick: () => dialog.close() }, 'Textanbieter einrichten')); return }
      ai.disabled = false
      ai.onclick = async () => {
        ai.disabled = true
        let done = 0
        try {
          for (let i = 0; i < ids.length; i += 12) {
            aiNote.textContent = `Schickt ${Math.min(i + 12, ids.length)} von ${ids.length} Bildern an ${provider.title} …`
            const result = await api('/assets/ai-tags', 'POST', { ids: ids.slice(i, i + 12) })
            done += result.tagged.length
          }
          aiNote.textContent = done === 1 ? '1 Bild verschlagwortet. Die Tags sind Vorschläge.' : `${done} Bilder verschlagwortet. Die Tags sind Vorschläge.`
          await load()
        } catch (error) {
          aiNote.replaceChildren(error.message, ' ', el('button', { type: 'button', class: 'btn sm', onclick: () => ai.click() }, 'Erneut versuchen'))
        } finally { ai.disabled = false }
      }
    }).catch(error => { aiNote.textContent = error.message })
    dialog.append(el('form', { method: 'dialog' }, el('h2', {}, ids.length === 1 ? 'Tags' : `Tags für ${ids.length} Einträge`),
      el('p', { class: 'meta' }, 'Klick setzt den Tag für alle, Alt-Klick oder Klick auf einen gesetzten Tag entfernt ihn. Teilweise gesetzte Tags tragen eine Zahl.'),
      filter, list, aiNote, el('div', { class: 'row' }, ai, accept, el('button', { class: 'btn primary', value: 'done' }, 'Fertig'))))
    dialog.addEventListener('close', () => { dialog.remove(); after?.() }, { once: true })
    document.body.append(dialog)
    dialog.showModal()
    try { await load() } catch (error) { list.replaceChildren(el('p', { role: 'alert' }, error.message)) }
  }

  /* Tags verwalten (#/tags) */
  async function renderTagManager() {
    const body = el('div', { class: 'scroll' }, h.loading(3))
    view.replaceChildren(...h.header('Tags', 'Gruppen, Namen und Synonyme. Synonyme finden dasselbe wie der Tag selbst, auch auf Englisch.'), body)
    async function draw() {
      try { await loadVocabulary() } catch (error) { return body.replaceChildren(h.errorState(error, renderTagManager)) }
      const facetSelect = (tag, facet) => el('select', { class: 'text-in', 'aria-label': `Gruppe von ${tag.name}`, onchange: async event => {
        try { await api('/tags/' + encodeURIComponent(tag.id), 'PUT', { facet: event.target.value }); await draw() } catch (error) { toast(error.message, true); await draw() }
      } }, vocabulary.filter(entry => entry.editable).map(entry => el('option', { value: entry.id, selected: entry.id === facet.id ? true : null }, entry.name)))
      body.replaceChildren(el('div', { class: 'tag-manager' }, vocabulary.map(facet => el('section', { class: 'tag-section' },
        el('h2', {}, facet.name, el('span', { class: 'meta' }, ` ${facet.tags.length}`)),
        facet.editable ? el('form', { class: 'row', onsubmit: async event => {
          event.preventDefault()
          const input = event.target.elements.name
          if (!input.value.trim()) return
          try { await api('/tags', 'POST', { facet: facet.id, name: input.value }); await draw() } catch (error) { toast(error.message, true) }
        } }, el('input', { class: 'text-in', name: 'name', placeholder: 'Neuer Tag in ' + facet.name, 'aria-label': 'Neuer Tag in ' + facet.name, autocomplete: 'off' }), el('button', { class: 'btn sm' }, icon('plus'), 'Anlegen')) :
          el('p', { class: 'meta' }, 'Diese Tags entstehen automatisch aus den Daten.'),
        facet.tags.length ? el('div', { class: 'tag-rows' }, facet.tags.map(tag => el('div', { class: 'tag-row' },
          el('input', { class: 'text-in', value: tag.name, 'aria-label': 'Name von ' + tag.name, disabled: facet.editable ? null : true, onchange: async event => {
            try { await api('/tags/' + encodeURIComponent(tag.id), 'PUT', { name: event.target.value }); await draw() } catch (error) { toast(error.message, true); await draw() }
          } }),
          el('input', { class: 'text-in', value: tag.aliases.join(', '), placeholder: 'Synonyme, mit Komma getrennt', 'aria-label': 'Synonyme von ' + tag.name, disabled: facet.editable ? null : true, onchange: async event => {
            try { await api('/tags/' + encodeURIComponent(tag.id), 'PUT', { aliases: event.target.value.split(',').map(entry => entry.trim()).filter(Boolean) }); toast('Synonyme gespeichert.') } catch (error) { toast(error.message, true) }
          } }),
          el('span', { class: 'meta n', title: 'Einträge mit diesem Tag' }, tag.count),
          facet.editable ? facetSelect(tag, facet) : el('span'),
          facet.editable ? el('select', { class: 'text-in', 'aria-label': `${tag.name} zusammenführen mit`, onchange: async event => {
            const target = names.get(event.target.value)
            if (!target) return
            if (await confirmDialog('Tags zusammenführen?', `„${tag.name}“ geht in „${target.name}“ auf. Der Name bleibt als Synonym erhalten.`, 'Zusammenführen')) {
              try { await api(`/tags/${encodeURIComponent(tag.id)}/merge`, 'POST', { target: target.id }); await draw() } catch (error) { toast(error.message, true) }
            } else event.target.value = ''
          } }, el('option', { value: '' }, 'Zusammenführen mit …'), facet.tags.filter(other => other.id !== tag.id).map(other => el('option', { value: other.id }, other.name))) : el('span'),
          facet.editable ? el('button', { type: 'button', class: 'icon', 'aria-label': `${tag.name} löschen`, onclick: async () => {
            if (await confirmDialog('Tag löschen?', tag.count ? `„${tag.name}“ wird bei ${tag.count} Einträgen entfernt. Das lässt sich nicht rückgängig machen.` : `„${tag.name}“ wird gelöscht.`, 'Löschen')) {
              try { await api('/tags/' + encodeURIComponent(tag.id), 'DELETE'); await draw() } catch (error) { toast(error.message, true) }
            }
          } }, icon('trash')) : el('span')))) : null))))
    }
    await draw()
  }

  /* Sortieren (#/sortieren): neue Einträge einzeln durchgehen, nur mit der Tastatur */
  async function renderSortieren() {
    const body = el('div', { class: 'scroll' }, h.loading(2))
    view.replaceChildren(...h.header('Sortieren', 'Neue Einträge nacheinander ansehen. Enter übernimmt die Vorschläge.'), body)
    let items, index = 0
    try { await loadVocabulary(); items = (await api('/search?unreviewed=1&rating=all&limit=200&sort=new')).items } catch (error) { return body.replaceChildren(h.errorState(error, renderSortieren)) }
    const finish = () => { document.removeEventListener('keydown', keys); }
    async function step(next) {
      index = Math.min(Math.max(next, 0), items.length)
      show()
    }
    async function mark(item) { try { await api('/assets/reviewed', 'POST', { ids: [item.id] }) } catch (error) { toast(error.message, true) } }
    async function keys(event) {
      if (!body.isConnected) return finish()
      if (document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return
      const item = items[index]
      if (event.target.matches?.('input, textarea, select')) { if (event.key === 'Escape') event.target.blur(); return }
      if (!item) return
      const key = event.key.toLowerCase()
      try {
        if (key === 'enter') { event.preventDefault(); await api('/assets/accept-suggestions', 'POST', { ids: [item.id] }); await mark(item); toast('Übernommen.'); await step(index + 1) }
        else if (key === 'arrowright' || key === ' ') { event.preventDefault(); await mark(item); await step(index + 1) }
        else if (key === 'arrowleft') { event.preventDefault(); await step(index - 1) }
        else if (key === 'f') { await api('/assets/rating', 'POST', { ids: [item.id], rating: 1 }); await mark(item); toast('Favorit.'); await step(index + 1) }
        else if (key === 'x') { await api('/assets/rating', 'POST', { ids: [item.id], rating: -1 }); await mark(item); toast('Aussortiert.'); await step(index + 1) }
        else if (key === 't') { event.preventDefault(); body.querySelector('.tag-input input')?.focus() }
        else if (/^[1-9]$/.test(key) && state.projects[Number(key) - 1]) {
          const project = state.projects[Number(key) - 1]
          await api('/assign', 'POST', { id: item.id, projectId: project.id }); toast(`In „${project.title}“.`)
        }
      } catch (error) { toast(error.message, true) }
    }
    function show() {
      const item = items[index]
      if (!item) {
        finish()
        return body.replaceChildren(h.emptyState('check', items.length ? 'Alles sortiert' : 'Nichts zu sortieren', items.length ? `Du hast ${items.length} Einträge durchgesehen.` : 'Neue Bilder und Clips erscheinen hier, sobald sie in der Library oder Sammlung landen.',
          el('a', { class: 'btn primary', href: '#/library' }, 'Zur Library')))
      }
      const projects = state.projects.slice(0, 9)
      put(body, el('div', { class: 'sort' },
        el('div', { class: 'sort-stage' }, h.media(item, { full: true })),
        el('aside', { class: 'sort-side' },
          el('div', { class: 'meta', role: 'status' }, `${index + 1} von ${items.length}`),
          el('h2', {}, item.title),
          tagEditor(item),
          projects.length ? el('div', { class: 'field' }, el('span', {}, 'Projekt'), el('div', { class: 'chips' }, projects.map((project, i) => el('button', { type: 'button', class: 'chip',
            onclick: async () => { try { await api('/assign', 'POST', { id: item.id, projectId: project.id }); toast(`In „${project.title}“.`) } catch (error) { toast(error.message, true) } } }, el('kbd', {}, i + 1), project.title)))) : null,
          el('div', { class: 'sort-keys meta' }, el('span', {}, el('kbd', {}, 'Enter'), ' übernehmen'), el('span', {}, el('kbd', {}, '→'), ' weiter'), el('span', {}, el('kbd', {}, 'F'), ' Favorit'),
            el('span', {}, el('kbd', {}, 'X'), ' aussortieren'), el('span', {}, el('kbd', {}, 'T'), ' Tag eingeben')))))
    }
    document.addEventListener('keydown', keys)
    show()
  }

  return { loadVocabulary, readFilters, writeFilters, isActive, searchParams, filterBar, tagEditor, bulkDialog, renderTagManager, renderSortieren, get vocabulary() { return vocabulary } }
}
