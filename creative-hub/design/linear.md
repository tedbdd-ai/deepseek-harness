# Linear-Stil (Referenz für das Atelier)

Quelle: [Refero Styles, Linear](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) (DESIGN.md, CSS-Variablen, Tailwind v4), gelesen am 2026-11-20. Hier stehen nur die Werte, die das Atelier übernimmt, und wie sie auf die Hub-Tokens abgebildet sind (`web/app.css`, `apps/flows/ui/flows.css`).

## Farben

| Linear | Wert | Rolle bei Linear | Hub-Token |
| --- | --- | --- | --- |
| Void | `#08090a` | Grund | `--c-bg` |
| Carbon | `#0f1011` | Karten, Navigation | `--c-side`, `--c-panel` |
| Obsidian | `#161718` | gehobene Flächen | `--c-fill` |
| Graphite | `#23252a` | feine Ränder, Ghost-Buttons | `--c-fill-2`, `--c-hair` |
| Smoke | `#383b3f` | kräftigere Haarlinien | `--c-fill-3`, `--c-line` |
| Ash | `#62666d` | gedämpfter Text, inaktive Icons | `--c-fill-4` (Rand gewählter Elemente) |
| Fog | `#8a8f98` | Nebentext, Platzhalter | `--c-ink-3` |
| Mist | `#d0d6e0` | Fließtext, Buttontext | `--c-ink-2`, `--c-focus` |
| Paper | `#ffffff` | Überschriften, stärkster Text | `--c-ink` |
| Acid Lime | `#e4f222` | einzige farbige Aktion pro Ansicht | `--c-primary` |
| Coral Red | `#eb5757` | rote Fläche | `--c-danger` |

Portfarben in Flows bleiben funktional (Text, Bild, Video, Ton) und tragen immer ein Symbol.

## Schrift

- Inter Variable mit `font-feature-settings: "cv01", "ss03", "zero"`. Gewichte 400, 510 und 590, nie fett (700+).
- Laufweite: −0.010em bei 13–16 px, −0.011em bei 15 px, −0.012em bei 20–32 px, −0.022em ab 48 px.
- Größen: Label 12, Caption 13, Body klein 15, Body 16.
- Code und Tastenkürzel: Monospace (JetBrains Mono oder ui-monospace).

## Form

- Radien: Buttons und Eingabefelder 6 px, Badges 4 px, Karten 12 px, Pillen voll rund. Nichts über 12 px bei Karten.
- Trennung über Haarlinien (`#23252a`, `#383b3f`) und Innenschatten, nicht über Schlagschatten.
- Dichte kompakt, Grundeinheit 4 px, Abstände 8/12/24.

## Regeln

- Acid Lime nur für die eine Hauptaktion pro Ansicht, nie als Deko.
- Keine Verläufe auf Buttons, Karten oder Text.
- Fließtext nur in der Grauskala (Mist, Fog, Ash), nicht farbig.

## Abweichungen im Atelier

- Mindesthöhe für Bedienelemente bleibt 44/36 px mit 44-px-Trefferfläche (Apple HIG aus den globalen Regeln). Linear selbst ist kompakter.
- Fokusring in Mist statt Blau, damit die Akzentfarbe Acid Lime allein bleibt.

## Stand 2026-11-20: Farben zurückgenommen

Die Linear-Farben (Void-Schwarz, Acid Lime) sind wieder raus. Auf der großen Flows-Fläche war fast reines Schwarz mit hellem Punktraster zu anstrengend. Geblieben sind Inter, die Radien, Haarlinien statt Schatten und die Regel „eine Akzentfarbe“. Die aktuellen Farben stehen in `DESIGN.md`.
