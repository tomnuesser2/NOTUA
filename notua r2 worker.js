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

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,DELETE,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
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

// Nur "boards/...", "images/..." und "meta/..." sind je gültige Keys (siehe R2_DB/die ENCRYPTION-
// Kommentare in index.html — "meta/setup.json" ist der kleine, unverschlüsselte Marker, der anzeigt
// "für dieses Konto existiert schon ein Schlüssel") — alles andere (insbesondere ".." oder ein
// führendes "/", die aus dem users/<uid>/-Präfix ausbrechen könnten) wird abgelehnt, bevor der Key
// überhaupt mit dem Nutzer-Präfix zusammengesetzt wird.
function safeKey(rawKey) {
  if (!rawKey) return null;
  let key;
  try { key = decodeURIComponent(rawKey); } catch (e) { return null; }
  if (key.includes('..') || key.startsWith('/') || key.length > 300) return null;
  if (!/^(boards|images|meta)\//.test(key)) return null;
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

    if (url.pathname === '/usage' && request.method === 'GET') {
      const bytes = await userUsageBytes(env, uid);
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
      return json({ ok: true, deleted });
    }

    if (url.pathname === '/list' && request.method === 'GET') {
      const prefix = url.searchParams.get('prefix') || '';
      if (prefix.includes('..')) return err(400, 'bad prefix');
      let cursor, out = [];
      do {
        const listed = await env.NOTUA_BUCKET.list({ prefix: 'users/' + uid + '/' + prefix, cursor, limit: 1000 });
        for (const obj of listed.objects) out.push({ key: obj.key.slice(('users/' + uid + '/').length), size: obj.size, uploaded: obj.uploaded });
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
        return new Response(obj.body, { status: 200, headers });
      }
      if (request.method === 'HEAD') {
        const obj = await env.NOTUA_BUCKET.head(fullKey);
        if (!obj) return new Response(null, { status: 404, headers: corsHeaders() });
        return new Response(null, { status: 200, headers: Object.assign({ 'Content-Length': String(obj.size) }, corsHeaders()) });
      }
      if (request.method === 'PUT') {
        const body = await request.arrayBuffer();
        if (body.byteLength > MAX_OBJECT_BYTES) return err(413, 'object too large');
        const existing = await env.NOTUA_BUCKET.head(fullKey);
        const usage = await userUsageBytes(env, uid);
        const delta = body.byteLength - (existing ? existing.size : 0); // ein Überschreiben zählt nur die Differenz, nicht die volle neue Größe nochmal oben drauf
        if (usage + delta > QUOTA_BYTES) return err(413, 'quota exceeded');
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        await env.NOTUA_BUCKET.put(fullKey, body, { httpMetadata: { contentType } });
        return json({ ok: true, size: body.byteLength });
      }
      if (request.method === 'DELETE') {
        await env.NOTUA_BUCKET.delete(fullKey);
        return json({ ok: true });
      }
      return err(405, 'method not allowed');
    }

    return err(404, 'not found');
  },
};