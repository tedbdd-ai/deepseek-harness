/**
 * Section of the hub's project page: the documents of this project (Moodboards, Storyboards, Filme, Flows)
 * as cards that open them. Called by the hub with the project's id.
 */
import { render as renderFlows } from './block.js'

export const renderProject = (container, ctx) => renderFlows(container, ctx, { projectId: ctx.projectId, embedded: true })
