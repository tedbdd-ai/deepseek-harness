/** Step page „Figur und Set“: the Flows editor on this phase of the project's flow. */
import { render as renderFlows } from './block.js'

export const render = (container, ctx) => renderFlows(container, ctx, { step: 'cast', page: 'figur-und-set' })
