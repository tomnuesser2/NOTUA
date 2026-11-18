# NOTUA

Board-App für Notizen, Bilder, Links und Moodboards – live auf **https://notua.site** (GitHub Pages).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `index.html` | die komplette Web-App (eine Datei) |
| `sw.js` | Service Worker (Offline, Updates) – `CACHE_NAME` bei jeder Version hochzählen |
| `manifest.json`, `icon-*.png`, `favicon.*`, `app-icon.png`, `splash/` | Installierbare App (PWA), Icons, iOS-Startbilder |
| `.notua_version` | aktuelle Versionsnummer (gleich wie `APP_VERSION` in `index.html`) |
| `datenschutz.html`, `nutzungsbedingungen.html` | Rechtliches |
| `vorschau/` | Vorschau-Seiten der Desktop-App und des Startbilds (hinter dem Download-Button) |
| `desktop/` | Desktop-App für Windows + macOS (Electron) – siehe `desktop/README.md` |
| `.github/workflows/desktop.yml` | baut die Desktop-App auf GitHub (Actions → „NOTUA Desktop bauen“) |
| `.well-known/assetlinks.json` | für eine spätere Android-App (verknüpft sie mit notua.site) |
| `notua r2 worker.js`, `worker.js`, `wrangler.jsonc` | Cloudflare-Worker für Cloud Sync |
| `CNAME`, `.nojekyll` | Domain + GitHub-Pages-Einstellung |

## Neue Web-Version veröffentlichen

1. In `index.html` `APP_VERSION` hochzählen, dieselbe Nummer in `.notua_version`.
2. In `sw.js` `CACHE_NAME` um eins erhöhen (z. B. `notua-v329` → `notua-v330`).
3. Committen und pushen – nach 1–2 Minuten ist es auf notua.site live.

Die Handy-Apps (Android/iOS) sind vorerst raus (Stand 2.4.184) – das Android-Projekt steckt in der Git-Historie (Commit vor „Apps entfernt“).
Signierschlüssel und Passwörter liegen nur lokal unter `Dokumente\NOTUA\android-signing\`, nie im Repo.
