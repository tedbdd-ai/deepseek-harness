import { InputError } from '../store.mjs'

const mention = /@Bild([1-9]\d*)\b/gi

export const referenceMarks = prompt => [...prompt.matchAll(mention)].map(([, label]) => Number(label))
export const referenceOnlyPrompt = positions => [...positions.keys()].map(label => '@Bild' + label).join(' ')

// Each reference controls only the attributes assigned to it, in provider input order.
const roles = new Map(Object.entries({
  Ausgangsbild: 'Use this as the image to edit. Preserve its people, identity, body shape, framing, wardrobe and setting wherever the requested edit leaves them unchanged.',
  Identität: 'Match facial geometry, hair, skin tone and distinguishing features. Preserve this person’s identity and body proportions. Borrow wardrobe or pose only where explicitly requested.',
  Kleidung: 'Match garment cut, construction, material, colour and details only. Do not transfer the wearer’s face, identity, body shape, pose or skin markings.',
  Stil: 'Use only the medium, palette, surface texture and rendering style.',
  Komposition: 'Follow the framing, perspective, subject placement and negative space only.',
  Ort: 'Take only the environment, architecture and spatial layout.',
  Licht: 'Match light direction, softness, colour temperature and shadows only.',
  Pose: 'Use only body orientation, gesture, balance and gaze.',
  // Garment parts: each source lends one piece. Short and loose on purpose: long "ONLY … ignore …"
  // instructions made Scrabble results look staged (compare runs of 19.11., 12:25 vs. 15:45).
  'Kleidung: Oberteil': 'Use its top.',
  'Kleidung: Unterteil': 'Use its trousers or skirt.',
  'Kleidung: Jacke/Mantel': 'Use its jacket, coat or cape.',
  'Kleidung: Einteiler': 'Use its catsuit, dress or overall.',
  'Kleidung: Schuhe': 'Use its shoes.',
  'Kleidung: Accessoire': 'Use one accessory from it.',
  'Material & Farbe': 'Use its material and colours.',
  'Muster & Details': 'Use its trims and details.',
}))

const garmentRoles = [...roles.keys()].filter(role => role.startsWith('Kleidung') || role === 'Material & Farbe' || role === 'Muster & Details')

/** Situations Scrabble draws from, sent in English. */
// Each situation names something the person does there: a bare place reads as a backdrop and the
// models paste the person in front of it like wallpaper.
export const situations = new Map(Object.entries({
  'Halloween-Party im Altbau': 'at a Halloween party in an old apartment, talking with guests in the hallway',
  'Backstage im Club': 'backstage at a club, leaning against a concrete wall between cables and cases',
  'Nasse Straße bei Nacht': 'on a wet street at night, stepping off the curb as a car passes',
  'Hotellobby der 70er': 'in a 1970s hotel lobby, waiting at the reception desk',
  'Industriehalle im Nebel': 'in a hazy industrial hall, walking between steel pillars',
  'Fotostudio': 'in a photo studio between shots, adjusting a glove next to the lights',
  'Dachterrasse zur blauen Stunde': 'on a rooftop at dusk, sitting on the parapet with the city behind',
  'Spiegelsaal': 'in a hall of mirrors, checking the outfit in one of the mirrors',
  'Laufsteg': 'on a runway, mid-stride at the end of the catwalk',
  'U-Bahnhof': 'in an underground station, stepping out of a train',
  'Treppenhaus': 'on an old staircase, walking down with a hand on the railing',
  'Galerie-Eröffnung': 'at a gallery opening, standing with a glass among other guests',
}))

/** Short English names of the roles, used to label each attached image. */
export const roleNames = { Ausgangsbild: 'image to edit', Identität: 'identity', Kleidung: 'garment', Stil: 'style', Komposition: 'composition', Ort: 'location', Licht: 'lighting', Pose: 'pose', 'Kleidung: Oberteil': 'top only', 'Kleidung: Unterteil': 'bottom only', 'Kleidung: Jacke/Mantel': 'outer layer only', 'Kleidung: Einteiler': 'one-piece only', 'Kleidung: Schuhe': 'footwear only', 'Kleidung: Accessoire': 'one accessory only', 'Material & Farbe': 'material and colour only', 'Muster & Details': 'details only' }

/** Validates the stable aliases and maps them to the outgoing attachment positions. */
export function referencePlan(prompt, studio, ids) {
  const positions = new Map()
  const labels = studio?.referenceLabels
  for (const [i, id] of ids.entries()) {
    const label = labels === undefined ? i + 1 : labels?.[id]
    if (!Number.isSafeInteger(label) || label < 1 || positions.has(label)) {
      throw new InputError('Die Bildmarken passen nicht zu den angehängten Referenzen.')
    }
    positions.set(label, i + 1)
  }
  for (const label of referenceMarks(prompt)) {
    if (!positions.has(label)) throw new InputError(`@Bild${label} ist nicht angehängt. Ergänze das Bild oder entferne die Marke aus dem Prompt.`)
  }
  return positions
}

// The German presets of the composer, sent in the language image models follow best.
const english = new Map(Object.entries({
  Augenhöhe: 'eye level', Bodennähe: 'low angle from near the ground', Vogelperspektive: "bird's-eye view", Dreiviertelansicht: 'three-quarter view', Seitenansicht: 'side profile view',
  '24 mm Weitwinkel': '24mm wide-angle lens', '35 mm Reportage': '35mm reportage lens', '50 mm Normalobjektiv': '50mm standard lens', '85 mm Porträt': '85mm portrait lens', '100 mm Makro': '100mm macro lens', '135 mm Tele': '135mm telephoto lens',
  Fensterlicht: 'soft window light', Direktblitz: 'direct on-camera flash', 'Golden Hour': 'golden hour sunlight', Streiflicht: 'raking side light', Neonlicht: 'neon light', Softbox: 'large softbox studio light',
}))

export function appearanceText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 700) : ''
}

export function compileDirection(prompt, studio, ids, positions, model, provider, index = 0, count = 1, params = {}) {
  const falFlux = provider === 'fal' && /(?:^|\/)flux-2(?:[-/]|$)/i.test(model)
  // Scrabble with 2×/4× writes one scene per image.
  if (Array.isArray(studio?.prompts) && typeof studio.prompts[index] === 'string' && studio.prompts[index].trim()) prompt = studio.prompts[index]
  const translate = text => text.replace(mention, (_, label) => {
    const position = positions.get(Number(label))
    if (provider === 'kie' && model === 'kling-4-0/long-image' && params.skill === 'webpage') {
      return ['@style', '@subject'][position - 1] ?? `@image_${position}`
    }
    if (provider === 'kie' && /^kling-4-0\/(?:image|long-image)$/.test(model)) return `@image_${position}`
    return falFlux ? `@image${position}` : `Image ${position}`
  })
  const appearance = appearanceText(studio?.appearance)
  const onlyReferences = ids.length > 0 && !prompt.replace(mention, '').trim()
  const hotapi = provider === 'hotapi'
  const lines = [hotapi && onlyReferences ? 'Create one still image using the attached references.' : translate(prompt)]
  if (appearance) lines.push('Fixed subject appearance: ' + translate(appearance))
  // With `looks` (one per image of a 2×/4× run) each image gets its own camera look;
  // with `remixes` each image also gets its own garment jobs and situation.
  const remix = Array.isArray(studio?.remixes) ? studio.remixes[index] : undefined
  if (remix) studio = { ...studio, ...remix, roles: { ...studio.roles, ...remix.roles } }
  const look = remix ?? (Array.isArray(studio?.looks) ? studio.looks[index] : undefined)
  const situation = situations.get(studio?.situation) ?? (typeof studio?.situation === 'string' ? studio.situation.slice(0, 300) : '')
  if (situation) lines.push('The person is ' + situation + '.')
  for (const [key, label] of Object.entries({ setting: 'Scene', pose: 'Action and pose', angle: 'Camera angle', lens: 'Lens', light: 'Lighting' })) {
    const value = look?.[key] ?? studio?.[key]
    if (typeof value === 'string' && value.trim()) lines.push(label + ': ' + (english.get(value.trim()) ?? value.trim().slice(0, 500)))
  }
  const hasLegacyRoles = ids.some(id => roles.has(studio?.roles?.[id]))
  if (hotapi && ids.length) {
    if (hasLegacyRoles || onlyReferences) lines.push('Image numbers refer to the attached files in their supplied order.')
    ids.forEach((id,i) => {
      const role = studio?.roles?.[id]
      if (!roles.has(role)) return
      const guidance = role === 'Pose'
        ? 'Use this image for pose and gaze only. Preserve the chosen subject’s face and body proportions.'
        : roles.get(role)
      lines.push(`Image ${i + 1} — ${roleNames[role]}: ${guidance}`)
    })
    const subjectCount = ids.filter(id => studio?.roles?.[id] === 'Identität').length
    if (subjectCount > 1) lines.push('Keep the separately designated subjects visually distinct.')
    if (hasLegacyRoles || appearance) lines.push('Keep the pose anatomically plausible, with a natural balance and consistent perspective and lighting.')
    return lines.join('\n')
  }
  if (hasLegacyRoles) {
    // Models disagree most on who is in the picture; name the main subjects explicitly.
    const people = ids.map((id, i) => [studio?.roles?.[id], i + 1]).filter(([role]) => role === 'Identität' || role === 'Ausgangsbild').map(([, n]) => n)
    if (people.length === 1) lines.push(`One main person: the person from Image ${people[0]}.`)
    // People from one image and a place from another (or a drawn situation) tend to look pasted on.
    if (people.length && (situation || ids.some(id => studio?.roles?.[id] === 'Ort'))) lines.push('Photograph the person inside the scene, not in front of it: the same light, colour and shadows fall on the person and the surroundings, perspective and scale match, the person touches or uses the space (floor contact, leaning, sitting), and focus falls off naturally. It should look like one candid frame from a real shoot, not a composite.')
    if (people.length) lines.push('Natural photo look: real skin texture, true colours, no glossy retouching, no HDR or plastic sheen.')
    if (people.length > 1) lines.push(`Main subjects: ${people.length} different people, one each from ${people.map(n => 'Image ' + n).join(', ')}. Keep every person distinct; never merge their faces.`)
    const parts = ids.filter(id => garmentRoles.includes(studio?.roles?.[id]))
    if (parts.length > 1) lines.push('Mix these pieces into one outfit; the other people and backgrounds in those images are not part of the picture.')
  }
  // Keep the reference-only request neutral so the model can compose from the inputs.
  if (hasLegacyRoles || onlyReferences) {
    lines.push('Image numbers refer to the attached files in the order supplied. Follow the purpose given to each image in the request.')
    ids.forEach((id, i) => {
      const role = studio?.roles?.[id]
      const guidance = roles.get(role) ?? 'Use it only for the purpose specified in the request or as broad visual context.'
      lines.push(`Reference ${i + 1}: ${guidance}`)
    })
    lines.push('Keep each source separate. A source used for clothing, pose, style, location or lighting supplies only those attributes. Do not transfer the source wearer’s identity or body shape from such images. When editing an existing scene, preserve the original person and all details outside the requested change.')
  }
  if (studio?.vary === true && count > 1 && !look) {
    const shots = [
      'Capture the moment just before the action begins, with deliberate negative space.',
      'Capture the action mid-motion with an asymmetric composition.',
      'Show the immediate aftermath of the action, with foreground depth.',
      'Choose a quiet transitional moment and frame the subject off-centre.',
    ]
    lines.push(shots[index], 'Preserve the requested pose, framing and other explicitly assigned attributes.')
  }
  return lines.join('\n')
}
