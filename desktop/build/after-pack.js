// macOS: ohne Apple-Developer-Konto wird die App "ad-hoc" signiert. Auf Apple-Silicon-Macs startet eine
// App ganz ohne Signatur gar nicht ("beschädigt"); ad-hoc signiert erscheint nur die normale Warnung
// "nicht verifizierter Entwickler", die man einmal mit "Trotzdem öffnen" bestätigt.
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // Universal-Build: erst x64 und arm64 einzeln (Ordner *-temp), dann zusammengeführt. Nur das fertige Paket signieren.
  if (/-temp$/.test(context.appOutDir)) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
