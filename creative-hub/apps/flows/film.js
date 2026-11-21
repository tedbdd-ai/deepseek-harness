/** Page „Filme“: the films of the chosen project; opening one shows that document alone. */
import { render as renderFlows } from './block.js'

export const render = (container, ctx) => renderFlows(container, ctx, { kind: 'film', page: 'filme' })
