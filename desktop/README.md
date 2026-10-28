# NOTUA Desktop (Windows + macOS)

Echte Desktop-App für NOTUA, gebaut mit Electron. Sie lädt die Live-App von https://notua.site
(immer aktuell, offline über den Service Worker der Seite) und ergänzt, was der Browser nicht kann:

- schwebendes, durchsichtiges Startbild (`splash/splash.html`) im aktuellen NOTUA-Farbschema
- merkt Fenstergröße und -position, nur eine Instanz gleichzeitig
- externe Links öffnen im Standardbrowser, Google-Anmeldung als Popup in der App
- Rechtsklick-Menü mit Rechtschreibprüfung (Deutsch/Englisch), Mac-Menü auf Deutsch
- Hinweis, wenn eine neue Version der Desktop-App auf GitHub liegt
- Offline-Seite (`offline.html`), falls beim allerersten Start kein Internet da ist

## Neue Version veröffentlichen

1. In `package.json` die `version` erhöhen (z. B. 1.0.0 → 1.0.1), committen und pushen.
2. Auf github.com: Repo NOTUA → **Actions** → **NOTUA Desktop bauen** → **Run workflow**.
3. Nach ca. 10 Minuten liegen `NOTUA-Setup.exe` und `NOTUA-macOS.dmg` unter **Releases**.
   Die festen Download-Links (auch auf notua.site eingebaut):
   - https://github.com/tomnuesser2/NOTUA/releases/latest/download/NOTUA-Setup.exe
   - https://github.com/tomnuesser2/NOTUA/releases/latest/download/NOTUA-macOS.dmg

Die Inhalte von NOTUA selbst (index.html) brauchen keinen neuen Build: Die App lädt immer den aktuellen Stand von notua.site.

## Signatur

Windows und macOS sind noch nicht signiert. Windows zeigt beim ersten Start eventuell
„Der Computer wurde geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“.
macOS: Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.
Mit Apple-Developer-Konto bzw. Windows-Zertifikat lässt sich das später nachrüsten.

## Lokal starten (optional)

```
cd desktop
npm install
npm start
```
