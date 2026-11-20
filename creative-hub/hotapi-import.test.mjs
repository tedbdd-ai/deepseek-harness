import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './test-harness.mjs'
import * as core from './core.mjs'
import * as playground from './playground/host.mjs'
import * as hotapi from './providers/hotapi/host.mjs'

test('HotAPI catalog and localized model URL import the same complete image family', async t => {
  const previous = process.env.ATELIER_INSTANCE
  process.env.ATELIER_INSTANCE = 'nsfw'
  t.after(() => {
    if (previous === undefined) delete process.env.ATELIER_INSTANCE
    else process.env.ATELIER_INSTANCE = previous
  })
  const family = 'example-spicy'
  const text = family + '/text-to-image'
  const edit = family + '/image-edit'
  const video = 'video-example'
  const schema = properties => ({post:{requestBody:{content:{'application/json':{schema:{properties,required:Object.keys(properties)}}}}}})
  const paths = {
    ['/v1/'+text]:schema({prompt:{type:'string'},size:{anyOf:[{type:'string',const:'2K'},{type:'string',const:'4K'}]}}),
    ['/v1/'+edit]:schema({image:{anyOf:[{type:'string',format:'uri'},{type:'array',items:{type:'string'},maxItems:4}]}}),
  }
  t.mock.method(globalThis,'fetch',async url => {
    if (url === 'https://api.hotapi.ai/docs/json') return Response.json({paths})
    assert.equal(url,'https://api.hotapi.ai/v1/models')
    return Response.json({data:[{id:text,modal:'image'},{id:edit,modal:'image'},{id:video,modal:'video'}]})
  })
  const h=createHarness()
  t.after(()=>h.unmountAll())
  h.mount(core,{databasePath:':memory:'})
  h.mount(hotapi)
  h.mount(playground)
  const path='/creativity-playground/api/models'
  const catalog=await h.ctx.creativeProviders.call('hotapi','models',{})
  assert.deepEqual(catalog.map(item=>item.id),[text,edit,video])
  const [imported]=await h.json('POST',path,{url:'https://hotapi.ai/de/models/'+edit},201)
  assert.equal(imported.variants.edit.fields[0].maxItems,4)
  assert.deepEqual(imported.variants.text.fields[1].options,['2K','4K'])
  await h.json('POST',path,{provider:'hotapi',modelId:text},201)
  assert.equal((await h.json('GET',path)).length,1)
  assert.equal((await h.request('POST',path,{url:'https://hotapi.ai/models/'+video})).status,400)
})
