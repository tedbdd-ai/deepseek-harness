import { InputError } from '../../store.mjs'
import { referenceKinds, seedanceModes, seedancePromptLimit, seedanceTasks } from './seedance-options.mjs'

const referencePattern = /@(image|video|audio)(\d+)\b/gi
const marks = (kind, count) => Array.from({ length: count }, (_, index) =>
  '@' + kind[0].toUpperCase() + kind.slice(1) + (index + 1))

function referenceMarks(text) {
  return new Set(Array.from(text.matchAll(referencePattern), ([mark]) => mark.toLowerCase()))
}

const system = `Du überarbeitest einen Szenenprompt für Seedance 2.5 Flash nach dem SeeGen Prompt Guide.
Liefere ausschließlich den einsatzfertigen Prompt in der Sprache der Vorlage. Beginne direkt mit der sichtbaren Handlung, der Bildkomposition oder den Referenzrollen. Verwende konkrete Regieanweisungen und eine klare zeitliche Abfolge. Erhalte Thema, Absicht, Stilwünsche, vorgegebene Zeiten und wörtlichen Dialog. Erfinde keine neue Geschichte, zusätzliche Figuren, Stilvorgaben, Dialoge oder Schnitte. Baue Stichworte zu einer filmbaren Einstellung aus. Entferne leere Platzhalter.
Verwende nur die verfügbaren Referenzmarken, behalte jede bereits verwendete Marke bei und ordne Referenzen nur bei klarer Absicht einer Rolle zu. Beschreibe keine ungesehenen Mediendetails. Formuliere bei Bedarf, was konsistent bleiben soll, etwa Gesicht, Outfit, Produktdetails, Licht oder Kamerarichtung.
Bei Keyframes beschreibe die Bewegung ab dem Startframe und, falls vorhanden, einen plausiblen Übergang zum Endframe. Bei einem neuen Video nach Vorlage übertrage nur die gewünschten Referenzeigenschaften. Beim Bearbeiten benenne die gewünschte Änderung und die zu erhaltenden Elemente. Beim Verlängern ist @Video1 der Ausgangsclip. Beginne bei einem Anschluss am Ende mit dem letzten Bild und der laufenden Bewegung. Bei einem Anschluss am Anfang führe zur ersten Einstellung hin. Zeitangaben beziehen sich nur auf den zusätzlichen Abschnitt.
Nutze Zeitfenster nur, wenn mehrere Phasen sie sinnvoll machen. Bleibe innerhalb der gewählten Dauer. Bei automatischer Dauer erfinde keine Gesamtlänge, sondern beschreibe die Abfolge. Bei deaktivierter Tonerzeugung füge keine neuen Audioanweisungen hinzu. Wenn Ton gewünscht ist, trenne hörbare Elemente präzise von der visuellen Regie. Halte den Prompt so kurz wie möglich und so detailliert wie nötig.`

export async function improveSeedancePrompt(providers, body) {
  const { mode, duration } = body
  const draft = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!draft || draft.length > seedancePromptLimit) throw new InputError('Gib einen Prompt mit höchstens 20.480 Zeichen ein.')
  if (!seedanceModes.some(([id]) => id === mode)) throw new InputError('Wähle einen Seedance-Modus.')
  if (!Number.isInteger(duration) || (duration !== -1 && (duration < 4 || duration > 30))) {
    throw new InputError('Wähle eine gültige Videolänge.')
  }
  const task = mode === 'references' ? body.task : undefined
  if (mode === 'references' && !seedanceTasks.some(([id]) => id === task)) throw new InputError('Wähle eine gültige Referenzaufgabe.')
  const available = mode === 'frames' && body.startFrame === true ? marks('image', body.endFrame === true ? 2 : 1) : []
  if (mode === 'references') {
    for (const [kind, label, , max] of referenceKinds) {
      const count = body.referenceCounts?.[kind] ?? 0
      if (!Number.isInteger(count) || count < 0 || count > max) throw new InputError('Prüfe die Anzahl der Referenzen für „' + label + '“.')
      available.push(...marks(kind, count))
    }
  }
  const allowed = new Set(available.map(mark => mark.toLowerCase()))
  const required = referenceMarks(draft)
  if ([...required].some(mark => !allowed.has(mark))) {
    throw new InputError('Im Prompt steht eine Referenzmarke, für die in diesem Modus keine Datei ausgewählt ist.')
  }
  const provider = (await providers.list()).find(item => item.capabilities.includes('chat') && item.secrets.every(secret => secret.configured))
  if (!provider) throw new InputError('Richte unter „Anbieter“ einen Textanbieter ein, um Prompts zu verbessern.', 409)
  const context = {
    draft, mode, task, durationSeconds: duration === -1 || task === 'edit' ? 'automatisch' : duration,
    generateAudio: body.audio !== false, availableReferences: available,
    ...(task === 'extend' && { extensionDirection: body.extensionDirection === 'before' ? 'vor dem ersten Bild' : 'ab dem letzten Bild' }),
    ...(mode === 'frames' && available.length > 0 && { frameRoles: body.endFrame === true ? { '@Image1': 'Startframe', '@Image2': 'Endframe' } : { '@Image1': 'Startframe' } }),
  }
  const result = await providers.call(provider.id, 'chat', { system, prompt: JSON.stringify(context) })
  const prompt = typeof result.text === 'string' ? result.text.trim().replace(/^```(?:[\w-]+)?[ \t]*\r?\n|\r?\n```$/g, '').trim() : ''
  if (!prompt || prompt.length > seedancePromptLimit) {
    throw new InputError('Das Textmodell hat keinen verwendbaren Prompt geliefert. Versuche es erneut.', 502)
  }
  const returned = referenceMarks(prompt)
  if ([...returned].some(mark => !allowed.has(mark)) || [...required].some(mark => !returned.has(mark))) {
    throw new InputError('Der Vorschlag hat die Referenzmarken verändert. Versuche es erneut.', 502)
  }
  return { prompt: prompt.replace(referencePattern, mark => available.find(token => token.toLowerCase() === mark.toLowerCase())) }
}
