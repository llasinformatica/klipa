// ============================================
// ARQUIVO 5 de 6  ·  media.mjs
// Salvar em: klipa/netlify/functions/media.mjs
// Função: proxy de mídia — habilita o "Baixar vídeo pronto"
// ============================================

const CLIENTS = [
  { ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'US' } },
  { ua: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)', client: { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3', hl: 'en', gl: 'US' } },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' } },
  { ua: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15', client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' }, thirdParty: true }
];

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

async function player(id, c) {
  const body = { context: { client: c.client }, videoId: id, contentCheckOk: true, racyCheckOk: true };
  if (c.thirdParty) body.context.thirdParty = { embedUrl: 'https://www.youtube.com/' };
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': c.ua, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+419' },
      body: JSON.stringify(body)
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function bestProgressive(pr) {
  const f = (pr?.streamingData?.formats || []).filter((x) => x.url && (x.mimeType || '').includes('mp4'));
  if (!f.length) return null;
  f.sort((a, b) => (b.height || 0) - (a.height || 0));
  return f[0];
}

export default async (req) => {
  const u = new URL(req.url);
  const id = (u.searchParams.get('id') || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ ok: false, error: 'ID inválido.' }, 400);

  let pr = null, fmt = null;
  for (const c of CLIENTS) {
    const p = await player(id, c);
    if (!p) continue;
    if (p.playabilityStatus?.status === 'ERROR') continue;
    const f = bestProgressive(p);
    if (f) { pr = p; fmt = f; break; }
    if (!pr) pr = p;
  }
  if (!fmt) {
    return json({
      ok: false,
      error: pr?.playabilityStatus?.reason || 'O YouTube não liberou um arquivo progressivo para este vídeo a partir do servidor. Use "Arquivo local" para o download em HD.'
    }, 404);
  }

  const vd = pr.videoDetails || {};
  if (u.searchParams.get('probe')) {
    return json({ ok: true, height: fmt.height || 0, itag: fmt.itag, mime: fmt.mimeType, title: vd.title, author: vd.author, duration: Number(vd.lengthSeconds || 0) });
  }

  const range = req.headers.get('range');
  const headers = { 'user-agent': CLIENTS[0].ua, 'accept': '*/*', 'accept-language': 'en-US,en;q=0.9' };
  if (range) headers.range = range;

  const up = await fetch(fmt.url, { headers });
  if (!up.ok && up.status !== 206) return json({ ok: false, error: 'Falha ao obter a mídia (' + up.status + ').' }, 502);

  const h = new Headers();
  h.set('content-type', up.headers.get('content-type') || 'video/mp4');
  h.set('accept-ranges', 'bytes');
  h.set('access-control-allow-origin', '*');
  h.set('cache-control', 'public, max-age=600');
  const cl = up.headers.get('content-length'); if (cl) h.set('content-length', cl);
  const cr = up.headers.get('content-range'); if (cr) h.set('content-range', cr);

  return new Response(up.body, { status: up.status === 206 ? 206 : 200, headers: h });
};

export const config = { path: '/api/media', name: 'media' };