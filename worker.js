// NOTUA – eigener CORS-Proxy für das WoW-PvP-Check-Widget (nur für drustvar.com).
// Absichtlich fest verdrahtet auf genau ein Ziel (drustvar.com) und genau einen erlaubten Aufrufer
// (notua.site) — das ist kein offener "Proxy zu irgendwas"-Dienst, der irgendwann wegen Missbrauchs
// abgeschaltet wird, sondern nur für dieses eine Widget nutzbar. Genau das hält ihn im kostenlosen
// Cloudflare-Kontingent dauerhaft stabil, ohne dass sich das je wieder ändert wie bei corsproxy.io &
// Co.
const ALLOWED_ORIGIN = 'https://notua.site';
const TARGET_HOST = 'drustvar.com';

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    // Preflight — the browser sends this automatically before the real GET; nothing to do but say yes.
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');
    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400, headers: corsHeaders });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response('Invalid url', { status: 400, headers: corsHeaders });
    }
    if (targetUrl.hostname !== TARGET_HOST) {
      return new Response('This proxy only forwards to ' + TARGET_HOST, { status: 403, headers: corsHeaders });
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NOTUA/1.0; +https://notua.site)' },
      });
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: corsHeaders });
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};