# Creativity Hub

Ein DeepSeek-Harness-Web-Overlay für persönliche Notizen, Referenzen und Storyboards. Der Hub verwendet die Anmeldung des Harness-Webprofils. Er speichert seinen Bestand in einer lokalen SQLite-Datei. Die Installation ist für ein persönliches Harness-Profil mit einem Benutzer gedacht.

## Start im Harness

1. Wechsle im Fork in den Ordner `creative-hub`. Für den eingebetteten Excalidraw-Editor führe dort `npm install` und `npm run build` aus.
2. Kopiere `cordis.example.yml` als `cordis.local.yml` und setze den absoluten Pfad zu `host.mjs`. Optional kannst du unter `config.databasePath` einen absoluten Pfad für die SQLite-Datei eintragen. Standard ist `~/.creativity-hub/hub.sqlite`.
3. Starte im gebauten Harness-Checkout `pnpm dsh web --patch ./creative-hub/cordis.local.yml`. Melde dich wie gewohnt im Harness an und öffne `/creativity-hub`. Alternativ kannst du den Overlay-Pfad der installierten dsh-CLI übergeben.

## Clipper für Chrome und Edge

Lade den Ordner `clipper` als entpackte Erweiterung. Hinterlege in den Einstellungen die Adresse deines Harness. Das Kontextmenü **Im Creativity Hub speichern** übernimmt Titel, Quell-URL, Beschreibung oder markierten Text und die Bild-URL. Im Hub kannst du die Metadaten prüfen und den Clip speichern. Ein Clip speichert die Quell- und Vorschau-URL. Die Bilddatei wird beim Clippen nicht kopiert.

## Sammlungen und Storyboards

- **Clips** ist der Eingang für Webreferenzen. Die Suche durchsucht Titel, Quelle und Beschreibung.
- **Generation Library** importiert PNG, JPEG, WebP, GIF, MP4 und WebM bis 12 MB oder speichert einen Medienlink.
- **Projekte** bündeln Notizen und zugewiesene Assets. Das Storyboard ist eine Excalidraw-Szene mit Projektvorschau. Der Editor verwendet einen expliziten Speichern-Knopf. Bei einer parallelen Änderung meldet der Hub einen Konflikt.
- Die JSON-Routen stellen denselben Projektstand inklusive der Szene bereit. Der nächste Integrationsschritt ist ein authentifizierter MCP-Zugang für Claude, Codex und weitere Clients.

Ähnlichkeitssuche, Rendering-Jobs, Import ganzer Verzeichnisse und Composio sind noch nicht implementiert.
