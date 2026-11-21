/**
 * Frames as React Flow sub-flows: a node inside a frame carries `parentId` and a position relative to the frame, so
 * React Flow moves, selects and renders it with the frame. Shared by the engine (server) and the editor (browser).
 *
 * `adoptIntoFrames` brings any flow into that form: flows saved before sub-flows (absolute positions, no `parentId`)
 * and nodes dropped onto or dragged out of a frame. Membership follows the top-left corner of a node.
 */

/**
 * Orders nodes the way a person reads the canvas: along the axis on which they are spread wider
 * (left to right for a row of shots, top to bottom for a column), then along the other.
 */
export function readingOrder(nodes) {
  const spread = axis => Math.max(...nodes.map(node => node[axis])) - Math.min(...nodes.map(node => node[axis]))
  const [first, second] = nodes.length > 1 && spread('x') > spread('y') ? ['x', 'y'] : ['y', 'x']
  return [...nodes].sort((a, b) => (a[first] - b[first]) || (a[second] - b[second]))
}

const size = frame => ({ width: Number(frame.params?.width) || 640, height: Number(frame.params?.height) || 480 })

/**
 * @param {{ x: number, y: number, parentId?: string }} node
 * @param {Map<string, object>} byId all nodes of the flow by id.
 * @returns {{ x: number, y: number }} the node's position on the canvas.
 */
export function absolute(node, byId) {
  const parent = node.parentId && byId.get(node.parentId)
  return parent ? { x: parent.x + node.x, y: parent.y + node.y } : { x: node.x, y: node.y }
}

/**
 * Assigns every node to the frame its top-left corner lies in (positions become relative), releases nodes that lie
 * in no frame (positions become absolute) and puts frames first, as React Flow requires parents before children.
 * Frames do not nest.
 * @param {{ nodes: object[], edges: object[] }} doc
 * @param {(node: object) => boolean} isFrame
 * @returns {{ doc: { nodes: object[], edges: object[] }, changed: boolean }}
 */
export function adoptIntoFrames(doc, isFrame) {
  const byId = new Map(doc.nodes.map(node => [node.id, node]))
  const frames = doc.nodes.filter(isFrame)
  let changed = false
  const others = doc.nodes.filter(node => !isFrame(node)).map(node => {
    const at = absolute(node, byId)
    const home = frames.find(frame => { const { width, height } = size(frame); return at.x >= frame.x && at.y >= frame.y && at.x < frame.x + width && at.y < frame.y + height })
    const next = home ? { ...node, parentId: home.id, x: at.x - home.x, y: at.y - home.y } : { ...node, x: at.x, y: at.y }
    if (!home) delete next.parentId
    if (next.parentId !== node.parentId || next.x !== node.x || next.y !== node.y) { changed = true; return next }
    return node
  })
  const plainFrames = frames.map(frame => { if (!frame.parentId) return frame; changed = true; const { parentId, ...rest } = frame; return { ...rest, ...absolute(frame, byId) } })
  const nodes = [...plainFrames, ...others]
  if (nodes.some((node, i) => node !== doc.nodes[i])) changed = true
  return { doc: { ...doc, nodes }, changed }
}
