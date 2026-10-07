/**
 * NOTUA – Cloudflare Worker: authenticated proxy in front of the "notua-user-assets" R2 bucket.
 *
 * Warum es das überhaupt braucht: der R2-Bucket selbst braucht Zugangsdaten (Access Key / Secret Key,
 * das "S3-kompatible" API), und die dürfen NIEMALS in index.html landen — die Datei ist komplett
 * öffentlich einsehbar (jeder kann "Seitenquelltext anzeigen"). Dieser Worker läuft stattdessen als
 * kleiner Vermittler dazwischen: er selbst braucht GAR KEINE Zugangsdaten, weil er über ein natives
 * Cloudflare-"Binding" direkt auf den Bucket zugreift (siehe Schritt 2 unten) — das ist eine
 * Berechtigung, die Cloudflare intern verwaltet, kein Passwort/Key, der irgendwo im Code steht oder
 * jemals leaken könnte. Genau das erfüllt "es soll niemand über den Code die API fetchen können".
 *
 * Jede Anfrage (außer den zwei öffentlichen /relay-Schritten unten) muss ein gültiges Login
 * mitbringen — entweder Google (denselben Access Token, den index.html schon für Drive holt) oder
 * einen von diesem Worker selbst ausgestellten "Device Token" (siehe /device-token weiter unten).
 * Beide lösen sich in verifyUser zu derselben stabilen Nutzer-ID auf, aus der sich eine feste,
 * private "Schublade" für genau diesen Nutzer ergibt (users/<uid>/...). Niemand kann die Daten eines
 * anderen Nutzers lesen oder überschreiben.
 *
 * ---------------------------------------------------------------------------------------------------
 * DEPLOYMENT (Cloudflare-Dashboard, einmalig):
 *
 * 1. dash.cloudflare.com -> "Workers & Pages" -> "Create" -> "Create Worker".
 *    Einen Namen geben (z.B. "notua-r2-sync") -> "Deploy" (der Platzhalter-Code ist erstmal egal).
 * 2. Auf der neuen Worker-Seite -> "Settings" -> "Bindings" -> "Add binding" -> "R2 Bucket":
 *      Variable name:  NOTUA_BUCKET
 *      R2 bucket:      notua-user-assets   (der Bucket, den du schon erstellt hast)
 *    Speichern.
 * 3. Immer noch "Settings" -> "Variables" -> "Add variable":
 *      Name:   GOOGLE_CLIENT_ID
 *      Wert:   die gleiche Client-ID, die schon in index.html als GOOGLE_CLIENT_ID drinsteht
 *              (928872575646-h8244hvb98n1l39tabgskhtjsak6aovh.apps.googleusercontent.com)
 *    Das ist kein Geheimnis (steht ja schon öffentlich in index.html) — "Encrypt" ist optional.
 *    Speichern.
 * 4. "Edit code" (oder der Quick-Edit-Button) -> kompletten Platzhalter-Inhalt löschen -> diese ganze
 *    Datei reinkopieren -> "Deploy".
 * 5. Oben auf der Worker-Seite steht jetzt eine URL wie
 *    https://notua-r2-sync.DEIN-SUBDOMAIN.workers.dev — genau diese URL mir schicken, dann baue ich
 *    sie in index.html (R2_SYNC_WORKER_URL) ein und du bekommst eine neue Version zum Einspielen.
 *    Keine weitere Variable nötig — dieser Worker hält selbst kein Verschlüsselungsgeheimnis mehr.
 *
 * ---------------------------------------------------------------------------------------------------
 * NEU (Version 2.4.106) — "Schlüsseltresor": Anmeldung auf einem neuen Gerät nur mit Google, ohne Code.
 * Der Datenschlüssel eines Kontos wird zusätzlich hier im Worker verwahrt (/key), verschlüsselt mit einem
 * Geheimnis, das nur dieser Worker kennt. Dafür EINMALIG eine Variable anlegen:
 *    Settings -> Variables and Secrets -> Add -> Typ "Secret"
 *      Name:  KEY_WRAP_SECRET
 *      Wert:  eine lange, zufällige Zeichenfolge (z.B. 40+ Zeichen, nirgends sonst verwenden)
 * und diesen Worker neu deployen. WICHTIG: dieses Geheimnis nie ändern oder löschen — sonst lassen sich die
 * bereits abgelegten Schlüssel nicht mehr entschlüsseln (die Geräte, die den Schlüssel noch lokal haben,
 * legen ihn dann beim nächsten Start einfach neu ab, aber ein komplett neues Gerät käme erst wieder per
 * "Gerät verknüpfen" an die Daten).
 * Ohne diese Variable bleibt alles wie vorher (GET /version meldet keyvault:false, die App nutzt dann
 * weiter nur das Verknüpfen per Code). Ehrlich gesagt: mit dem Tresor ist es KEINE Ende-zu-Ende-
 * Verschlüsselung mehr — wer den Worker samt Secret und Bucket kontrolliert, kann die Daten lesen.
 * ---------------------------------------------------------------------------------------------------
 *
 * Zur Verschlüsselung: jeder Account bekommt seinen AES-256-GCM-Schlüssel ausschließlich im Browser
 * (auf dem allerersten Gerät, das je eingerichtet wird — siehe r2GenerateFirstKey in index.html).
 * Dieser Worker ist daran nie beteiligt und sieht bei GET/PUT auf /object/... nur die fertig
 * verschlüsselten Bytes. Jedes WEITERE Gerät bekommt denselben Schlüssel, indem es sich mit einem
 * bereits eingerichteten Gerät "verknüpft" (QR-Code oder Code von Hand, siehe die QR/CODE DEVICE
 * LINKING-Sektion in index.html) — ein Diffie-Hellman-Schlüsselaustausch (ECDH), bei dem dieser
 * Worker nur als "Briefkasten" für die zwei öffentlichen Schlüssel dient (/relay/<code>/{a,b,r}
 * unten): er sieht beide öffentlichen ECDH-Schlüssel und ein Stück Chiffretext, kann daraus aber
 * mathematisch NICHT den gemeinsamen Schlüssel berechnen (dasselbe Vertrauensmodell wie beim
 * Geräte-Verknüpfen von WhatsApp Web/Signal). Damit ist das jetzt echtes Ende-zu-Ende: selbst mit
 * vollem Zugriff auf diesen Worker UND den Bucket lässt sich der eigentliche Datenschlüssel nicht
 * rekonstruieren — auch nicht von dir als Betreiber. Kehrseite, unvermeidbar bei echter
 * Ende-zu-Ende-Verschlüsselung: geht der Schlüssel auf jedem Gerät, das ihn je hatte, verloren, sind
 * die Cloud-Daten für immer unlesbar, auch für dich — /reset unten ist der einzige Ausweg (alles für
 * diesen Nutzer löschen, neu anfangen). Lokale Speicherung (IndexedDB, ein verbundener Ordner) ist
 * von alldem komplett unberührt.
 *
 * Device Tokens (/device-token): ein bereits verknüpftes Gerät kann beim Verknüpfen eines neuen
 * Geräts nebenbei einen eigenen Zugangs-Token für dieses Konto ausstellen lassen — das neue Gerät
 * authentifiziert sich damit von da an direkt bei diesem Worker, ganz ohne eigenes Google-Login
 * ("ohne den Google OAuth sondern direkt zum Server"). So ein Token ist ein reines Zugangsmittel (er
 * gewährt Lesen/Schreiben im verschlüsselten Bucket-Bereich des Kontos, NICHT das Entschlüsseln —
 * das bleibt separat an den ECDH-übertragenen Schlüssel gebunden) und hat, anders als ein
 * Google-Token, noch keine eingebaute Ablaufzeit; /reset widerruft alle Tokens eines Kontos auf
 * einen Schlag.
 * ---------------------------------------------------------------------------------------------------
 */

const QUOTA_BYTES = 100 * 1024 * 1024; // 100MB pro Nutzer — Toms Vorgabe
const MAX_OBJECT_BYTES = 8 * 1024 * 1024; // Sicherheitsgrenze pro einzelner Datei — Bilder sind zu diesem Zeitpunkt schon <=150KB (siehe compressImageForStorage in index.html), Board-JSONs sind winzig; das hier fängt nur etwas kaputtes/riesiges ab, bevor es überhaupt versucht wird
const RELAY_MAX_BYTES = 4096; // /relay-Objekte sind winzig (ein öffentlicher ECDH-Schlüssel + etwas Chiffretext, ~150 Bytes) — großzügig genug für alles Legitime, eng genug um anonyme Ablage großer Dateien darüber zu verhindern

// Sync-Protokoll-Version, die dieser Worker versteht. index.html fragt sie über GET /version ab: ab
// Protokoll 2 schaltet die App auf die neue Cloud-Sync-Engine (versionierte Dokumente pro Board,
// bedingte Writes per ETag, stiller Merge pro Eigenschaft). Ein älterer Worker kennt /version nicht
// (404) — die App bleibt dann automatisch bei der alten Engine, bis dieser Worker eingespielt ist.
const SYNC_PROTOCOL = 2;

// ETags werden nach außen immer ohne Anführungszeichen und ohne W/-Präfix geführt (so, wie R2 sie in
// obj.etag liefert) — der Browser schickt sie 1:1 in If-Match zurück, hier wird nur noch einmal
// defensiv bereinigt, falls ein Proxy dazwischen sie in Anführungszeichen gesetzt hat.
function cleanEtag(v) { return String(v || '').replace(/^W\//, '').replace(/^"|"$/g, ''); }

// Verbrauchs-Cache pro Nutzer (lebt nur innerhalb eines Worker-Isolates). Vorher wurde bei JEDEM
// Schreibvorgang der komplette Bucket-Bereich des Nutzers neu durchgezählt (list über alle Objekte) —
// das wurde mit wachsender Objektzahl immer langsamer und war einer der Gründe, warum sich Sync zäh
// anfühlte. Jetzt wird höchstens alle 20 Sekunden wirklich gezählt und dazwischen mitgerechnet; wird
// das Limit nach Cache-Stand überschritten, zählt der Worker vor dem Ablehnen noch einmal live nach,
// damit ein veralteter Cache nie fälschlich "Speicher voll" melden kann.
const USAGE_CACHE_MS = 20000;
const usageCache = new Map();
function invalidateUsage(uid) { usageCache.delete(uid); }
async function reserveQuota(env, uid, delta) {
  let c = usageCache.get(uid);
  if (!c || Date.now() - c.at > USAGE_CACHE_MS) {
    c = { bytes: await userUsageBytes(env, uid), at: Date.now() };
    usageCache.set(uid, c);
  }
  if (c.bytes + delta > QUOTA_BYTES) {
    c.bytes = await userUsageBytes(env, uid); c.at = Date.now();
    if (c.bytes + delta > QUOTA_BYTES) return false;
  }
  c.bytes += delta;
  return true;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,DELETE,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,If-Match,If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '86400',
  };
}
function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()) });
}
function err(status, msg) { return json({ error: msg }, status); }

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomDeviceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  // 'ndt_' (NOTUA device token) prefix lets verifyUser recognize this at a glance, no extra network
  // round trip needed to tell it apart from a Google access token (those never start with this).
  return 'ndt_' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToB64(bytes) { let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); }
function b64ToBytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
// Wickel-Schlüssel des Tresors: aus dem Worker-Geheimnis und der Nutzer-ID abgeleitet (HKDF), damit jeder
// Nutzer einen eigenen hat und ein Eintrag nie mit dem eines anderen Kontos entschlüsselbar ist.
async function vaultWrapKey(env, uid) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.KEY_WRAP_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('notua-keyvault-v1'), info: new TextEncoder().encode(uid) },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Verifies whichever credential came with the request — a Google access token (the same one
// index.html already gets for Drive) OR a NOTUA device token this Worker itself issued earlier (see
// /device-token) — and returns the stable, path-safe user id either resolves to, or null if neither
// checks out.
async function verifyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return null;
  const token = m[1];
  if (token.startsWith('ndt_')) {
    const hash = await sha256Hex(token);
    const obj = await env.NOTUA_BUCKET.get('devicetokens/' + hash + '.json');
    if (!obj) return null;
    try { const data = JSON.parse(await obj.text()); return data.uid || null; } catch (e) { return null; }
  }
  let info;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token));
    if (!res.ok) return null; // abgelaufen/ungültig/widerrufen — Google beantwortet das mit einem Fehlerstatus
    info = await res.json();
  } catch (e) { return null; }
  if (!info || info.aud !== env.GOOGLE_CLIENT_ID) return null; // gehört nicht zu dieser App
  const raw = info.sub || info.user_id; // beide Feldnamen kommen je nach Google-Antwortformat vor
  if (!raw) return null;
  const uid = String(raw).replace(/[^a-zA-Z0-9_-]/g, ''); // defensiv gesäubert, auch wenn Google-IDs schon safe sind — das wird gleich ein echtes Pfad-Präfix im Bucket
  return uid || null;
}

// Nur "boards/...", "images/...", "meta/..." und "v2/..." (neue Sync-Engine) sind je gültige Keys (siehe R2_DB/die ENCRYPTION-
// Kommentare in index.html — "meta/setup.json" ist der kleine, unverschlüsselte Marker, der anzeigt
// "für dieses Konto existiert schon ein Schlüssel") — alles andere (insbesondere ".." oder ein
// führendes "/", die aus dem users/<uid>/-Präfix ausbrechen könnten) wird abgelehnt, bevor der Key
// überhaupt mit dem Nutzer-Präfix zusammengesetzt wird.
function safeKey(rawKey) {
  if (!rawKey) return null;
  let key;
  try { key = decodeURIComponent(rawKey); } catch (e) { return null; }
  if (key.includes('..') || key.startsWith('/') || key.length > 300) return null;
  if (!/^(boards|images|meta|v2)\//.test(key)) return null;
  return key;
}

// Summiert die tatsächliche Bytegröße von allem, was dieser Nutzer gerade im Bucket liegen hat — echte
// Live-Zahl statt eines mitgeführten Zählers, der mit der Zeit von der Realität abweichen könnte (z.B.
// wenn ein Schreibvorgang mal fehlschlägt). Bei realistisch <1000 Objekten pro Nutzer (siehe Toms
// eigene Kalkulation: ~660 Bilder bei 150KB füllen die 100MB) ist das immer schnell genug für einen
// Check direkt vor jedem Schreibvorgang.
async function userUsageBytes(env, uid) {
  let total = 0, cursor;
  do {
    const listed = await env.NOTUA_BUCKET.list({ prefix: 'users/' + uid + '/', cursor });
    for (const obj of listed.objects) total += obj.size;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return total;
}

// ---------- /relay/<code>/<slot> — die (größtenteils) unauthentifizierte QR/Code-Geräteverknüpfung ----------
// Bewusst NICHT unter users/<uid>/... — der ganze Witz ist, dass das neue Gerät (Slot 'b') noch gar
// keine uid kennt. Codes sind kurz, zufällig und praktisch nicht zu erraten (33^8 ≈ 1.4 Billionen
// Kombinationen); ohne den exakten Code kann niemand einen Slot lesen oder beschreiben.
// Slot 'a': das bereits verknüpfte Gerät veröffentlicht seinen öffentlichen ECDH-Schlüssel.
// Slot 'b': das neue, noch nicht verknüpfte Gerät veröffentlicht SEINEN öffentlichen ECDH-Schlüssel —
//   das ist genau der Schritt, für den es bewusst KEIN Login braucht.
// Slot 'r': das bereits verknüpfte Gerät veröffentlicht das Ergebnis (den echten Datenschlüssel + ein
//   frisches Device Token, mit dem gemeinsamen ECDH-Geheimnis verschlüsselt) — hier wird ein gültiges
//   Login verlangt, rein als Spam-/Missbrauchsschutz (ein Skript soll nicht einfach wahllos Codes mit
//   Müll "beantworten" können); an der eigentlichen Verschlüsselung ändert das nichts, das Ergebnis
//   bleibt so oder so für diesen Worker undurchsichtiger Chiffretext.
function relaySlotKey(code, slot) { return 'relay/' + code + '/' + slot + '.json'; }
async function handleRelay(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['relay', code, slot]
  if (parts.length !== 3) return err(400, 'bad relay path');
  const code = parts[1], slot = parts[2];
  if (!/^[A-Za-z0-9-]{4,20}$/.test(code) || !['a', 'b', 'r'].includes(slot)) return err(400, 'bad relay path');
  const key = relaySlotKey(code, slot);

  if (request.method === 'GET') {
    const obj = await env.NOTUA_BUCKET.get(key);
    if (!obj) return err(404, 'not found');
    return new Response(obj.body, { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()) });
  }
  if (request.method === 'PUT') {
    if (slot === 'r') {
      const uid = await verifyUser(request, env);
      if (!uid) return err(401, 'unauthorized');
    } else {
      const existing = await env.NOTUA_BUCKET.head(key);
      if (existing) return err(409, 'already claimed'); // ein Code ist pro Slot Einweg — kein Überschreiben
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > RELAY_MAX_BYTES) return err(413, 'too large');
    await env.NOTUA_BUCKET.put(key, body, { httpMetadata: { contentType: 'application/json' } });
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    await env.NOTUA_BUCKET.delete(key);
    return json({ ok: true });
  }
  return err(405, 'method not allowed');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);

    if (url.pathname.startsWith('/relay/')) return handleRelay(request, env, url);

    const uid = await verifyUser(request, env);
    if (!uid) return err(401, 'unauthorized');

    if (url.pathname === '/version' && request.method === 'GET') {
      return json({ proto: SYNC_PROTOCOL, keyvault: !!env.KEY_WRAP_SECRET });
    }

    // Schlüsseltresor (siehe Kopfkommentar): der Datenschlüssel des Kontos, vom Worker verschlüsselt abgelegt,
    // damit sich ein neues Gerät nur mit Google-Login (oder Device Token) den Schlüssel selbst holen kann.
    // PUT legt ihn nur an, wenn noch keiner existiert (409 sonst) — ein bestehender wird nie überschrieben.
    if (url.pathname === '/key') {
      if (!env.KEY_WRAP_SECRET) return err(501, 'keyvault not configured');
      const vaultObjKey = 'users/' + uid + '/keyvault/key.json';
      if (request.method === 'GET') {
        const obj = await env.NOTUA_BUCKET.get(vaultObjKey);
        if (!obj) return err(404, 'not found');
        try {
          const rec = JSON.parse(await obj.text());
          const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(rec.iv) }, await vaultWrapKey(env, uid), b64ToBytes(rec.ct));
          return json({ key: bytesToB64(new Uint8Array(plain)) });
        } catch (e) { return err(500, 'keyvault decrypt failed'); }
      }
      if (request.method === 'PUT') {
        let raw;
        try { raw = b64ToBytes(String((await request.json()).key || '')); } catch (e) { return err(400, 'bad key'); }
        if (raw.length !== 32) return err(400, 'bad key');
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultWrapKey(env, uid), raw));
        const written = await env.NOTUA_BUCKET.put(vaultObjKey, JSON.stringify({ v: 1, iv: bytesToB64(iv), ct: bytesToB64(ct) }), { onlyIf: { etagDoesNotMatch: '*' } });
        if (written === null) return json({ error: 'already exists' }, 409);
        return json({ ok: true });
      }
      return err(405, 'method not allowed');
    }

    if (url.pathname === '/usage' && request.method === 'GET') {
      const bytes = await userUsageBytes(env, uid);
      usageCache.set(uid, { bytes, at: Date.now() });
      return json({ bytes, limit: QUOTA_BYTES });
    }

    // Stellt für dieses (bereits authentifizierte) Konto einen neuen Device Token aus — aufgerufen
    // vom bereits verknüpften Gerät als letzter Schritt der QR/Code-Verknüpfung (r2OfferDeviceLink in
    // index.html), bevor es den Token zusammen mit dem echten Datenschlüssel ECDH-verschlüsselt an
    // das neue Gerät weitergibt. Der rohe Token wird nur hier, einmalig, zurückgegeben — gespeichert
    // wird nur sein SHA-256-Hash, wie bei Passwörtern/API-Keys üblich.
    if (url.pathname === '/device-token' && request.method === 'POST') {
      const token = randomDeviceToken();
      const hash = await sha256Hex(token);
      await env.NOTUA_BUCKET.put('devicetokens/' + hash + '.json', JSON.stringify({ uid, createdAt: Date.now() }));
      // Zusätzlich (nur der Hash, nie der rohe Token) unter der eigenen users/<uid>/-Schublade
      // abgelegt, rein damit /reset unten alle Tokens dieses Kontos wiederfinden und widerrufen kann —
      // die globale devicetokens/<hash>.json oben ist sonst nicht anhand einer uid auffindbar.
      await env.NOTUA_BUCKET.put('users/' + uid + '/devicetokens/' + hash + '.json', JSON.stringify({ createdAt: Date.now() }));
      return json({ token });
    }

    // Löscht restlos ALLES, was dieser Nutzer im Bucket hat, und widerruft jeden je für dieses Konto
    // ausgestellten Device Token — der einzige Weg zurück, wenn der Datenschlüssel auf jedem Gerät,
    // das ihn je hatte, verloren ist (siehe "Cloud-Daten zurücksetzen" in index.html).
    if (url.pathname === '/reset' && request.method === 'DELETE') {
      let cursor, deleted = 0;
      do {
        const listed = await env.NOTUA_BUCKET.list({ prefix: 'users/' + uid + '/devicetokens/', cursor, limit: 1000 });
        for (const obj of listed.objects) {
          const hash = obj.key.split('/').pop().replace(/\.json$/, '');
          await env.NOTUA_BUCKET.delete('devicetokens/' + hash + '.json');
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      cursor = undefined;
      do {
        const listed = await env.NOTUA_BUCKET.list({ prefix: 'users/' + uid + '/', cursor, limit: 1000 });
        for (const obj of listed.objects) { await env.NOTUA_BUCKET.delete(obj.key); deleted++; }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      invalidateUsage(uid);
      return json({ ok: true, deleted });
    }

    if (url.pathname === '/list' && request.method === 'GET') {
      const prefix = url.searchParams.get('prefix') || '';
      if (prefix.includes('..')) return err(400, 'bad prefix');
      let cursor, out = [];
      do {
        const listed = await env.NOTUA_BUCKET.list({ prefix: 'users/' + uid + '/' + prefix, cursor, limit: 1000 });
        for (const obj of listed.objects) out.push({ key: obj.key.slice(('users/' + uid + '/').length), size: obj.size, uploaded: obj.uploaded, etag: cleanEtag(obj.etag) });
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      return json(out);
    }

    if (url.pathname.startsWith('/object/')) {
      const key = safeKey(url.pathname.slice('/object/'.length));
      if (!key) return err(400, 'bad key');
      const fullKey = 'users/' + uid + '/' + key;

      if (request.method === 'GET') {
        const obj = await env.NOTUA_BUCKET.get(fullKey);
        if (!obj) return err(404, 'not found');
        const headers = Object.assign({}, corsHeaders());
        if (obj.httpMetadata && obj.httpMetadata.contentType) headers['Content-Type'] = obj.httpMetadata.contentType;
        headers['ETag'] = '"' + cleanEtag(obj.etag) + '"';
        return new Response(obj.body, { status: 200, headers });
      }
      if (request.method === 'HEAD') {
        const obj = await env.NOTUA_BUCKET.head(fullKey);
        if (!obj) return new Response(null, { status: 404, headers: corsHeaders() });
        return new Response(null, { status: 200, headers: Object.assign({ 'Content-Length': String(obj.size), 'ETag': '"' + cleanEtag(obj.etag) + '"' }, corsHeaders()) });
      }
      if (request.method === 'PUT') {
        const body = await request.arrayBuffer();
        if (body.byteLength > MAX_OBJECT_BYTES) return err(413, 'object too large');
        const existing = await env.NOTUA_BUCKET.head(fullKey);
        // Bedingte Writes (Grundlage der neuen Sync-Engine): "If-Match: <etag>" schreibt nur, wenn das
        // Objekt seit dem Lesen unverändert ist; "If-None-Match: *" nur, wenn es noch gar nicht
        // existiert. Schlägt die Bedingung fehl, antwortet der Worker 412 — der Browser lädt dann die
        // neue Fassung, führt beide zusammen und schreibt erneut. So kann kein Gerät mehr unbemerkt die
        // Änderung eines anderen überschreiben ("lost update").
        const ifMatch = request.headers.get('If-Match');
        const ifNone = request.headers.get('If-None-Match');
        const putOpts = { httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' } };
        if (ifMatch) {
          if (!existing || cleanEtag(existing.etag) !== cleanEtag(ifMatch)) return json({ error: 'precondition failed' }, 412);
          putOpts.onlyIf = { etagMatches: cleanEtag(ifMatch) };
        } else if (ifNone === '*') {
          if (existing) return json({ error: 'precondition failed' }, 412);
          putOpts.onlyIf = { etagDoesNotMatch: '*' };
        }
        const delta = body.byteLength - (existing ? existing.size : 0); // ein Überschreiben zählt nur die Differenz, nicht die volle neue Größe nochmal oben drauf
        if (delta > 0 && !(await reserveQuota(env, uid, delta))) return err(413, 'quota exceeded');
        const written = await env.NOTUA_BUCKET.put(fullKey, body, putOpts);
        if (written === null) return json({ error: 'precondition failed' }, 412); // jemand war zwischen head() und put() schneller
        return json({ ok: true, size: body.byteLength, etag: cleanEtag(written && written.etag) });
      }
      if (request.method === 'DELETE') {
        await env.NOTUA_BUCKET.delete(fullKey);
        invalidateUsage(uid);
        return json({ ok: true });
      }
      return err(405, 'method not allowed');
    }

    return err(404, 'not found');
  },
};