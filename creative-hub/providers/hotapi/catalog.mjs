import { ProviderError } from '../../providers.mjs'
import { fieldsOf } from '../schema.mjs'
import { request } from '../http.mjs'

const origin = 'https://api.hotapi.ai'
const modelPage = family => 'https://hotapi.ai/models/' + family

function cachedJson(path) {
  let expires = 0, pending
  return () => {
    if (!pending || expires < Date.now()) {
      expires = Date.now() + 300_000
      pending = request('HotAPI', origin + path, {timeout:20000}).then(r => r.json()).catch(error => {
        pending = undefined
        throw error
      })
    }
    return pending
  }
}

const list = cachedJson('/v1/models')
const contract = cachedJson('/docs/json')

export async function catalog() {
  const result = await list()
  if (!Array.isArray(result.data)) throw new ProviderError('HotAPI hat keinen lesbaren Modellkatalog geliefert.')
  return result.data.map(({id,modal}) => ({id,title:id,modal,page:modelPage(id.split('/')[0])}))
}

function inputFields(schema) {
  const properties = {}
  for (const [key,prop] of Object.entries(schema.properties ?? {})) {
    const choices = prop.anyOf ?? prop.oneOf ?? []
    const array = choices.find(item => item.type === 'array')
    if (array) properties[key] = {...prop,...array,anyOf:undefined,oneOf:undefined}
    else if (choices.length && choices.every(item => typeof item.const === 'string')) {
      properties[key] = {...prop,type:'string',enum:choices.map(item=>item.const),anyOf:undefined,oneOf:undefined}
    } else properties[key] = prop
  }
  return fieldsOf({...schema,properties})
}

export async function resolveModels(env, {url}) {
  const address = new URL(url)
  const parts = address.pathname.split('/').filter(Boolean)
  const models = await catalog()
  const ids = new Set(models.map(m=>m.id.split('/')[0]))
  const query = address.searchParams.get('model') || address.searchParams.get('modelId')
  const family = query ? query.split('/')[0] : parts.find(p=>ids.has(p))
  const spec = await contract()
  let members = models.filter(m=>m.id.split('/')[0]===family)
  if (!members.length && parts.includes('api')) {
    const slug = parts.at(-1)
    members = models.filter(m=>spec.paths['/v1/'+m.id]?.post?.operationId?.toLowerCase()===slug.replaceAll('-','').toLowerCase())
    if (members.length) members = models.filter(m=>m.id.split('/')[0]===members[0].id.split('/')[0])
  }
  if (!members.length) throw new ProviderError('Gib die HotAPI-Adresse eines konkreten Modells ein.',400)
  if (!members.some(m=>m.modal==='image')) throw new ProviderError('Diese HotAPI-Adresse gehört zu einem '+({video:'Video',audio:'Audio',text:'Text'}[members[0].modal] ?? 'anderen')+'modell. Der Bild-Playground importiert Bildmodelle.',400)
  const group = members[0].id.split('/')[0]
  const variants = {}
  for (const m of members.filter(m=>m.modal==='image')) {
    const schema = spec.paths['/v1/'+m.id]?.post?.requestBody?.content?.['application/json']?.schema
    if (!schema?.properties) throw new ProviderError('HotAPI veröffentlicht kein Eingabeschema für '+m.id+'.')
    const fields = inputFields(schema)
    const refs = fields.filter(field=>['image','images'].includes(field.type))
    const variant = {model:m.id,fields}
    if (!refs.some(f=>f.required)) variants.text=variant
    if (refs.length) variants.edit=variant
  }
  return [{id:'catalog:hotapi:'+group,title:group,provider:'hotapi',providerTitle:'HotAPI',page:modelPage(group),variants}]
}
