/** Page „Storyboards“: the Storyboards of the chosen project; opening one shows that document alone. */
import { render as renderFlows } from './block.js'

export const render = (container, ctx) => renderFlows(container, ctx, { kind: 'storyboard', page: 'storyboard' })
