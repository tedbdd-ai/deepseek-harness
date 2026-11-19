import { InputError } from '../store.mjs'

const mention = /@Bild([1-9]\d*)\b/gi

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
  // Garment parts: each source supplies exactly one piece, so several images combine into one new outfit.
  'Kleidung: Oberteil': 'Take ONLY the top (shirt, blouse, bodice or corset) from this image: cut, material, colour and details. Ignore the person, the other clothes and the background.',
  'Kleidung: Unterteil': 'Take ONLY the bottom (trousers, skirt or leggings) from this image: cut, length, material, colour and details. Ignore everything else in it.',
  'Kleidung: Jacke/Mantel': 'Take ONLY the outer layer (jacket, coat or cape) from this image: cut, volume, length, material and details. Ignore everything else in it.',
  'Kleidung: Einteiler': 'Take ONLY the one-piece garment (catsuit, dress or overall) from this image: cut, coverage, material, colour and details. Ignore everything else in it.',
  'Kleidung: Schuhe': 'Take ONLY the footwear from this image. Ignore everything else in it.',
  'Kleidung: Accessoire': 'Take ONLY one accessory from this image (gloves, hood, mask, belt, harness, jewellery or bag). Ignore everything else in it.',
  'Material & Farbe': 'Take ONLY the material, surface finish and colour palette of the clothing in this image and apply them to the new outfit. Do not copy the cut of its garments.',
  'Muster & Details': 'Take ONLY the trims, seams, hardware, buckles, ruffles or prints of the clothing in this image and work them into the new outfit. Do not copy whole garments.',
}))

const garmentRoles = [...roles.keys()].filter(role => role.startsWith('Kleidung') || role === 'Material & Farbe' || role === 'Muster & Details')

/** Situations Scrabble draws from, sent in English. */
export const situations = new Map(Object.entries({
  'Halloween-Party im Altbau': 'a Halloween party in a candle-lit Berlin Altbau apartment with guests in costume',
  'Backstage im Club': 'backstage in a techno club, concrete walls, cables, a door to the dance floor',
  'Nasse Straße bei Nacht': 'a rain-soaked city street at night with reflections on the asphalt',
  'Hotellobby der 70er': 'a 1970s hotel lobby with brass, velvet and warm lamps',
  'Industriehalle im Nebel': 'an empty industrial hall with haze and shafts of light',
  'Fotostudio': 'a professional photo studio with a seamless backdrop',
  'Dachterrasse zur blauen Stunde': 'a rooftop terrace at blue hour above the city',
  'Spiegelsaal': 'a baroque hall of mirrors with tall windows',
  'Laufsteg': 'a fashion show runway with an audience in the dark',
  'U-Bahnhof': 'an empty underground station with tiled walls and fluorescent light',
  'Treppenhaus': 'a grand old staircase with wrought-iron railings',
  'Galerie-Eröffnung': 'a contemporary art gallery opening with white walls and guests',
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
  for (const [, label] of prompt.matchAll(mention)) {
    if (!positions.has(Number(label))) throw new InputError(`@Bild${label} ist nicht angehängt. Ergänze das Bild oder entferne die Marke aus dem Prompt.`)
  }
  return positions
}

// The German presets of the composer, sent in the language image models follow best.
const english = new Map(Object.entries({
  Augenhöhe: 'eye level', Bodennähe: 'low angle from near the ground', Vogelperspektive: "bird's-eye view", Dreiviertelansicht: 'three-quarter view', Seitenansicht: 'side profile view',
  '24 mm Weitwinkel': '24mm wide-angle lens', '35 mm Reportage': '35mm reportage lens', '50 mm Normalobjektiv': '50mm standard lens', '85 mm Porträt': '85mm portrait lens', '100 mm Makro': '100mm macro lens', '135 mm Tele': '135mm telephoto lens',
  Fensterlicht: 'soft window light', Direktblitz: 'direct on-camera flash', 'Golden Hour': 'golden hour sunlight', Streiflicht: 'raking side light', Neonlicht: 'neon light', Softbox: 'large softbox studio light',
}))

export function compileDirection(prompt, studio, ids, positions, model, provider, index = 0, count = 1) {
  const falFlux = provider === 'fal' && /(?:^|\/)flux-2(?:[-/]|$)/i.test(model)
  const lines = [prompt.replace(mention, (_, label) => {
    const position = positions.get(Number(label))
    return falFlux ? `@image${position}` : `Image ${position}`
  })]
  // With `looks` (one per image of a 2×/4× run) each image gets its own camera look;
  // with `remixes` each image also gets its own garment jobs and situation.
  const remix = Array.isArray(studio?.remixes) ? studio.remixes[index] : undefined
  if (remix) studio = { ...studio, ...remix, roles: { ...studio.roles, ...remix.roles } }
  const look = remix ?? (Array.isArray(studio?.looks) ? studio.looks[index] : undefined)
  const situation = situations.get(studio?.situation) ?? (typeof studio?.situation === 'string' ? studio.situation.slice(0, 300) : '')
  if (situation) lines.push('Situation: ' + situation + '.')
  for (const [key, label] of Object.entries({ setting: 'Scene', pose: 'Action and pose', angle: 'Camera angle', lens: 'Lens', light: 'Lighting' })) {
    const value = look?.[key] ?? studio?.[key]
    if (typeof value === 'string' && value.trim()) lines.push(label + ': ' + (english.get(value.trim()) ?? value.trim().slice(0, 500)))
  }
  if (ids.length) {
    // Models disagree most on who is in the picture; name the main subjects explicitly.
    const people = ids.map((id, i) => [studio?.roles?.[id], i + 1]).filter(([role]) => role === 'Identität' || role === 'Ausgangsbild').map(([, n]) => n)
    if (people.length === 1) lines.push(`Main subject: exactly one person, the person from Image ${people[0]}. Any other people are background only unless the request explicitly asks for them.`)
    else if (people.length > 1) lines.push(`Main subjects: ${people.length} different people, one each from ${people.map(n => 'Image ' + n).join(', ')}. Keep every person distinct; never merge their faces.`)
    const parts = ids.filter(id => garmentRoles.includes(studio?.roles?.[id]))
    if (parts.length > 1) lines.push('Combine the garment sources into ONE coherent new outfit worn by the main subject. It must look designed as a whole, with consistent materials and fit, not like a collage. Each source contributes only its assigned part.')
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
