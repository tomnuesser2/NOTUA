# NOTUA für Android

Trusted Web Activity: Die App öffnet https://notua.site in Chrome, ohne Browserleiste. Google-Anmeldung,
Boards und Offline-Speicher sind dieselben wie in der installierten Web-App. Paketname: `site.notua.twa`.

- Startbild: Mono-Icon auf dunklem Grund, danach der animierte NOTUA-Ladebildschirm aus `index.html`.
- Icon: `app/src/main/res` (adaptives Icon, auch als einfarbiges „Themed Icon“).
- Version erhöhen: `versionCode` und `versionName` in `app/build.gradle`.

## Bauen

Der Signierschlüssel liegt **nicht** im Repo (sonst könnte jeder Apps als NOTUA signieren).
Er liegt bei Tom unter `Dokumente\NOTUA\android-signing\` (Datei + Passwort). Bitte sicher aufbewahren:
ohne denselben Schlüssel lassen sich keine Updates über die installierte App spielen.

```
set NOTUA_KEYSTORE=C:\Users\Tommy\Documents\NOTUA\android-signing\notua-release.jks
set NOTUA_KEYSTORE_PASSWORD=<aus password.txt>
gradle assembleRelease
```
Ergebnis: `app/build/outputs/apk/release/app-release.apk` → als `NOTUAMobileApp.apk` ins Repo-Hauptverzeichnis.

Der SHA-256-Fingerabdruck des Schlüssels steht in `/.well-known/assetlinks.json`; nur dann erkennt Chrome die App
als NOTUA und blendet die Browserleiste aus.
