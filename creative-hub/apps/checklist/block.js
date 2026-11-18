// Checkliste: data = { items: [{ text, done }] }
export function render(container, { data, save, ui }) {
  let items = Array.isArray(data.items) ? data.items : []
  const list = ui.element('ul', '', 'checklist')
  const form = ui.element('form', '', 'inline-add')
  const input = ui.element('input')
  input.placeholder = 'Punkt hinzufügen …'
  input.maxLength = 500
  input.setAttribute('aria-label', 'Neuer Punkt')
  form.append(input, ui.element('button', 'Hinzufügen'))
  const commit = next => { items = next; draw(); save({ items }) }
  function draw() {
    list.replaceChildren(...items.map((item, index) => {
      const li = ui.element('li', '', item.done ? 'done' : '')
      const label = ui.element('label')
      const box = ui.element('input')
      box.type = 'checkbox'
      box.checked = item.done
      box.onchange = () => commit(items.map((other, i) => i === index ? { ...other, done: box.checked } : other))
      label.append(box, ui.element('span', item.text))
      const remove = ui.iconButton('×', item.text + ' entfernen', () => commit(items.filter((_, i) => i !== index)))
      li.append(label, remove)
      return li
    }))
  }
  form.onsubmit = event => {
    event.preventDefault()
    const value = input.value.trim()
    if (!value) return
    input.value = ''
    commit([...items, { text: value, done: false }])
  }
  draw()
  container.append(list, form)
}
