/**
 * Turns model input schemas published by providers (OpenAPI/JSON Schema from fal.ai, OpenAPI YAML
 * from docs.kie.ai) into the field list the Playground renders. Only the YAML subset those docs use
 * is read: nested maps, lists, plain/quoted scalars, `[a, b]` flow lists and `>`/`|` block scalars.
 */

/**
 * One input field of a model.
 * @typedef {{ key: string, label: string, type: 'prompt'|'text'|'enum'|'boolean'|'integer'|'number'|'images'|'image',
 *   required: boolean, default?: unknown, options?: string[], min?: number, max?: number, maxItems?: number, description: string }} Field
 */

function scalar(raw) {
  const value = raw.trim()
  if (value === '' || value === '~' || value === 'null') return null
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'")
  if (/^".*"$/.test(value)) { try { return JSON.parse(value) } catch { return value.slice(1, -1) } }
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (/^\[.*\]$/.test(value)) return value.slice(1, -1).split(',').map(item => scalar(item)).filter(item => item !== null)
  if (value === '{}') return {}
  return value
}

/**
 * Parses the YAML subset described above.
 * @param {string} source YAML text.
 * @returns {any} the parsed value.
 */
export function parseYaml(source) {
  const lines = source.split('\n').map(line => line.replace(/\t/g, '  ')).filter(line => line.trim() && !line.trim().startsWith('#'))
  let i = 0
  const indentOf = line => line.length - line.trimStart().length

  function block(indent, folded, keep) {
    const parts = []
    while (i < lines.length && (indentOf(lines[i]) > indent)) parts.push(lines[i++].trim())
    return folded ? parts.join(' ') : parts.join('\n') + (keep ? '\n' : '')
  }

  function value(indent, rest) {
    const text = rest.trim()
    if (text === '>' || text === '>-' || text === '|' || text === '|-') return block(indent, text.startsWith('>'), false)
    if (text) return scalar(text)
    if (i < lines.length && indentOf(lines[i]) > indent) return node(indentOf(lines[i]))
    if (i < lines.length && indentOf(lines[i]) === indent && lines[i].trimStart().startsWith('- ')) return node(indent)
    return null
  }

  function node(indent) {
    if (lines[i].trimStart().startsWith('- ') || lines[i].trim() === '-') {
      const list = []
      while (i < lines.length && indentOf(lines[i]) === indent && (lines[i].trimStart().startsWith('- ') || lines[i].trim() === '-')) {
        const after = lines[i].trimStart().slice(2)
        const inner = indent + 2
        if (/^[^'"\s][^:]*:(\s|$)/.test(after) && !/^https?:/.test(after)) {
          lines[i] = ' '.repeat(inner) + after
          list.push(node(inner))
        } else if (after.trim().startsWith('- ')) {
          lines[i] = ' '.repeat(inner) + after
          list.push(node(inner))
        } else {
          i++
          list.push(value(indent, after))
        }
      }
      return list
    }
    const map = {}
    while (i < lines.length && indentOf(lines[i]) === indent && !lines[i].trimStart().startsWith('- ')) {
      const line = lines[i].trim()
      const match = /^('[^']*'|"[^"]*"|[^:]+?):(\s+(.*))?$/.exec(line)
      i++
      if (!match) continue
      const key = String(scalar(match[1]))
      map[key] = value(indent, match[3] ?? '')
    }
    return map
  }

  return lines.length ? node(indentOf(lines[0])) : null
}

const imageKey = /(^|_)(image|images|input_urls|image_urls|image_input|reference)(_|$)|_urls?$/

/**
 * Normalizes a JSON-Schema object of model inputs.
 * @param {any} schema `{ properties, required, x-fal-order-properties? }`.
 * @param {(ref: string) => any} resolve resolves `$ref` strings.
 * @returns {Field[]} fields in display order; unsupported fields are left out.
 */
export function fieldsOf(schema, resolve = () => undefined) {
  const props = schema?.properties ?? {}
  const required = new Set(schema?.required ?? [])
  const order = schema?.['x-fal-order-properties'] ?? Object.keys(props)
  const fields = []
  for (const key of order) {
    let prop = props[key]
    if (!prop) continue
    if (prop.$ref) prop = resolve(prop.$ref) ?? prop
    const variants = prop.anyOf ?? prop.oneOf
    if (variants) {
      const pick = variants.find(v => v.enum) ?? variants.find(v => v.type && v.type !== 'null') ?? {}
      prop = { ...pick, ...prop, type: pick.type, enum: pick.enum }
    }
    const base = { key, label: prop.title || key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), required: required.has(key), description: String(prop.description ?? '').trim(), ...(prop.default !== undefined && { default: prop.default }) }
    if (key === 'prompt') fields.push({ ...base, type: 'prompt' })
    else if (prop.type === 'array' && (prop.items?.type === 'string' || prop.items?.format === 'uri') && imageKey.test(key)) {
      const documentedMax = /(?:maximum of|up to|max(?:imum)?[: ]+)\s*(\d+)\s+(?:reference |input |source )?images\b/i.exec(base.description)
      const maxItems = prop.maxItems ?? (documentedMax ? Number(documentedMax[1]) : undefined)
      fields.push({ ...base, type: 'images', ...(maxItems && { maxItems }) })
    }
    else if (prop.type === 'string' && (prop.format === 'uri' || /^(?:image|input_image|reference_image|start_image|end_image)_url$/.test(key)) && imageKey.test(key)) fields.push({ ...base, type: 'image' })
    else if (Array.isArray(prop.enum) && prop.enum.length) fields.push({ ...base, type: 'enum', options: prop.enum.map(String) })
    else if (prop.type === 'boolean') fields.push({ ...base, type: 'boolean' })
    else if (prop.type === 'integer' || prop.type === 'number') fields.push({ ...base, type: prop.type, ...(prop.minimum !== undefined && { min: prop.minimum }), ...(prop.maximum !== undefined && { max: prop.maximum }) })
    else if (prop.type === 'string' && !prop.format) fields.push({ ...base, type: 'text' })
  }
  return fields
}

/**
 * Keeps only parameters a model accepts, with values its schema allows.
 * @param {Field[]} fields the model's fields.
 * @param {Record<string, unknown>} params values chosen in the Playground.
 * @returns {Record<string, unknown>} input without prompt and image fields.
 */
export function pickParams(fields, params = {}) {
  const input = {}
  for (const field of fields) {
    const value = params[field.key]
    if (value === undefined || value === '' || value === null) continue
    if (field.type === 'enum' && field.options.includes(String(value))) input[field.key] = String(value)
    else if (field.type === 'boolean' && typeof value === 'boolean') input[field.key] = value
    else if ((field.type === 'integer' || field.type === 'number') && Number.isFinite(Number(value))) input[field.key] = field.type === 'integer' ? Math.round(Number(value)) : Number(value)
    else if (field.type === 'text' && typeof value === 'string') input[field.key] = value.slice(0, 2000)
  }
  return input
}
