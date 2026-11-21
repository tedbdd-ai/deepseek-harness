# ElevenLabs-Stil (Referenz für das Atelier)

Quelle: [Refero Styles, ElevenLabs](https://styles.refero.design/style/031056ff-7af1-46db-8daa-115f731c5d26), DESIGN.md vom Nutzer eingefügt am 2026-11-20. Er löst den Linear-Stil ab (`design/linear.md`, nur noch als Historie). Hier steht, was das Atelier übernimmt und wie es auf die Hub-Tokens abgebildet ist (`web/app.css`, `apps/flows/ui/flows.css`).

## Farben (hell, Standard)

| ElevenLabs | Wert | Rolle | Hub-Token |
| --- | --- | --- | --- |
| Eggshell | `#fdfcfc` | Grund, Karten, Knoten | `--c-bg`, `--c-panel` |
| Warm Taupe | `#f5f3f1` | Seitenleiste, Flächen eine Stufe tiefer | `--c-side`, `--c-fill` |
| Stone | `#ebe8e4` | Haarlinien, Hover-Flächen | `--c-line`, `--c-fill-2` |
| Ink | `#000000` | Text, gefüllte Pillen-Buttons | `--c-ink`, `--c-primary`, `--c-neutral` |
| Graphite | `#44403b` | starker Nebentext | `--c-ink-2` |
| Smoke | `#777169` | Fließtext gedämpft | im Atelier `#6E6861` (`--c-ink-3`), damit 4,5:1 auch auf Taupe hält |
| Violet Spark / Ember Orange | `#0447ff` / `#ff4704` | nur in Produktbildern, nie als UI-Farbe | nicht als Token übernommen |

## Dunkelmodus (eigene Ableitung)

ElevenLabs Flows hat einen dunklen Canvas, das Stil-Paket beschreibt aber nur Hell. Abgeleitet: Grund `#111111`, Flächen `#181818`–`#2F2F2F`, Text `#F5F3F1`/`#CBC6C0`/`#9A948C`, Buttons als helle Pille (`#FDFCFC` mit schwarzer Schrift).

## Punktraster

Bei ElevenLabs liegt das Raster kaum über dem Grund. Im Atelier: hell `#ECE9E5` auf `#FDFCFC`, dunkel `#1D1D1D` auf `#111111`, Abstand 20 px, Punkt 1 px. Unter 40 % Zoom wird das Raster ausgeblendet, sonst entsteht ein graues Moiré.

## Schrift

- Inter 400 für Text, 500 für Buttons und Hervorhebungen, nie fetter. Laufweite +0,01em bei 14–16 px.
- Überschriften im Flüsterton: Inter 300 (Ersatz für Waldenburg), −0,02em, 32 px für Seitentitel.

## Form

- Buttons, Tags und Werkzeugleisten als Pille (9999 px). Karten und Knoten 20 px, kleine Elemente 4–10 px.
- Flach: Haarlinien in Stone, höchstens der feine dreistufige Schatten von ElevenLabs für schwebende Leisten.
- Eine Hauptaktion pro Ansicht als schwarze Pille, Nebenaktionen als Outline-Pille.

## Abweichungen im Atelier

- Mindesthöhe 44/36 px mit 44-px-Trefferfläche (Apple HIG aus den globalen Regeln).
- Porttypen in Flows behalten ihre Funktionsfarben mit Symbol (DESIGN.md), weil Farbe dort Information trägt.
