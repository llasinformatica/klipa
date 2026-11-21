// transcript.mjs · Klipa/netlify/functions/transcript.mjs
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const COOKIE = 'CONSENT=YES+cb.20210328-17-p0.en+FX+419; SOCS=CAI';

const CLIENTS = [
  { name: 'WEB', ua: UA, cn: 1, client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'pt', gl: 'BR' } },
  { name: 'ANDROID', ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', cn: 3, client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'pt', gl: 'BR' } },
  { name: 'IOS', ua: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)', cn: 5, client: { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3', hl: 'pt', gl: 'BR' } },
  { name: 'MWEB', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', cn: 2, client: { clientName: 'MWEB', clientVersion: '2.20240726.01.00', hl: 'pt', gl: 'BR' } },
  { name: 'TV', ua: UA, cn: 85, client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'pt', gl: 'BR' }, thirdParty: true }
];

const json = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' }
});

async function race(p, ms) {
  let t; const to = new Promise(r => { t = setTimeout(() => r(null), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}

async function innertube(id, c) {
  const body = { context: { client: c.client }, videoId: id, contentCheckOk: true, racyCheckOk: true };
  if (c.thirdParty) body.context.thirdParty = { embedUrl: 'https://www.youtube.com/' };
  const r = await race(fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': c.ua,
      'x-youtube-client-name': String(c.cn), 'x-youtube-client-version': c.client.clientVersion,
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8', cookie: COOKIE, origin: 'https://www.youtube.com'
    },
    body: JSON.stringify(body)
  }), 8000);
  if (!r || !r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

function extractBalanced(html, marker) {
  let i = html.indexOf(marker);
  if (i < 0) return null;
  i = html.indexOf('{', i);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(html.slice(i, j + 1)); } catch { return null; } }
    }
  }
  return null;
}

async function scrape(id) {
  const r = await race(fetch('https://www.youtube.com/watch?v=' + id + '&hl=pt&bpctr=9999999999&has_verified=1', {
    headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9', cookie: COOKIE }
  }), 8000);
  if (!r || !r.ok) return null;
  const html = await r.text();
  return extractBalanced(html, 'ytInitialPlayerResponse =') || extractBalanced(html, 'ytInitialPlayerResponse=');
}

function pick(tracks, lang) {
  if (!tracks || !tracks.length) return null;
  const code = t => (t.languageCode || '').toLowerCase();
  const want = ((lang === 'auto' ? 'pt' : lang) || 'pt').toLowerCase().split('-')[0];
  const manual = tracks.filter(t => t.kind !== 'asr');
  return [
    manual.find(t => code(t) === want), manual.find(t => code(t).indexOf(want) === 0),
    tracks.find(t => code(t) === want), tracks.find(t => code(t).indexOf(want) === 0),
    manual.find(t => code(t).indexOf('pt') === 0), tracks.find(t => code(t).indexOf('pt') === 0),
    manual.find(t => code(t).indexOf('en') === 0), tracks.find(t => code(t).indexOf('en') === 0),
    manual[0], tracks[0]
  ].find(Boolean) || null;
}

function clean(words) {
  const out = [];
  for (const w of words) {
    const t = String(w.w).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev && prev.w === t && Math.abs(prev.s - w.s) < .05) continue;
    out.push({ w: t, s: +w.s.toFixed(3), e: +Math.max(w.s + .12, w.e).toFixed(3) });
  }
  out.sort((a, b) => a.s - b.s);
  for (let i = 0; i < out.length - 1; i++) if (out[i].e > out[i + 1].s) out[i].e = out[i + 1].s;
  return out;
}

function fromJson3(data) {
  const words = [];
  for (const ev of data.events || []) {
    if (!ev.segs) continue;
    const base = (ev.tStartMs || 0) / 1000, dur = (ev.dDurationMs || 0) / 1000;
    const segs = ev.segs.filter(s => s.utf8 && s.utf8.replace(/\n/g, ' ').trim());
    if (!segs.length) continue;
    const hasOff = segs.some(s => typeof s.tOffsetMs === 'number' && s.tOffsetMs > 0);
    if (hasOff || segs.length > 1) {
      segs.forEach((s, i) => {
        const txt = s.utf8.replace(/\n/g, ' ').trim(); if (!txt) return;
        const st = base + ((s.tOffsetMs || 0) / 1000);
        const nx = segs[i + 1];
        const en = nx ? base + ((nx.tOffsetMs || 0) / 1000) : base + dur;
        const parts = txt.split(/\s+/), span = Math.max(.18, en - st);
        parts.forEach((p, k) => words.push({ w: p, s: st + span * k / parts.length, e: st + span * (k + 1) / parts.length }));
      });
    } else {
      const txt = segs[0].utf8.replace(/\n/g, ' ').trim(), parts = txt.split(/\s+/);
      const span = Math.max(.2, dur || parts.length * .32);
      if (parts.length === 1) words.push({ w: parts[0], s: base, e: base + span });
      else {
        const tot = parts.reduce((a, p) => a + p.length + 1, 0); let t = base;
        for (const p of parts) { const d = span * (p.length + 1) / tot; words.push({ w: p, s: t, e: t + d }); t += d; }
      }
    }
  }
  return clean(words);
}

function fromXml(text) {
  const words = [];
  const dec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '');
  const re = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(text))) {
    const st = parseFloat(m[1]), dur = parseFloat(m[2] || '2');
    const txt = dec(m[3]).replace(/\n/g, ' ').trim(); if (!txt) continue;
    const parts = txt.split(/\s+/), tot = parts.reduce((a, p) => a + p.length + 1, 0); let t = st;
    for (const p of parts) { const d = dur * (p.length + 1) / tot; words.push({ w: p, s: t, e: t + d }); t += d; }
  }
  return clean(words);
}

async function grab(baseUrl) {
  for (const fmt of ['&fmt=json3', '&fmt=srv3', '']) {
    const r = await race(fetch(baseUrl + fmt, {
      headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9', cookie: COOKIE, referer: 'https://www.youtube.com/' }
    }), 8000);
    if (!r || !r.ok) continue;
    const body = await r.text();
    if (!body || body.length < 20) continue;
    let words = [];
    if (body.trim()[0] === '{') { try { words = fromJson3(JSON.parse(body)); } catch { words = []; } }
    if (!words.length && body.includes('<text')) words = fromXml(body);
    if (words.length) return words;
  }
  return [];
}

export default async (req) => {
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();
  const lang = (url.searchParams.get('lang') || 'auto').trim();
  if (url.searchParams.get('probe')) return json({ ok: true, probe: true, service: 'klipa-transcript-v9' });
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ ok: false, error: 'ID de vídeo inválido.' }, 400);

  let pr = null, used = '';
  const sc = await scrape(id);
  if (sc && sc.captions && sc.captions.playerCaptionsTracklistRenderer) { pr = sc; used = 'SCRAPE'; }
  if (!pr) {
    for (const c of CLIENTS) {
      const p = await innertube(id, c);
      if (!p) continue;
      if (!pr) { pr = p; used = c.name; }
      const ct = p.captions && p.captions.playerCaptionsTracklistRenderer && p.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (ct && ct.length) { pr = p; used = c.name; break; }
    }
  }
  if (!pr) return json({ ok: false, error: 'O YouTube não respondeu a partir do servidor (bloqueio de IP de datacenter ou vídeo privado).' }, 502);

  const vd = pr.videoDetails || {};
  const meta = { title: vd.title || '', author: vd.author || '', duration: Number(vd.lengthSeconds || 0) || 0 };
  const tracks = (pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];

  if (tracks.length) {
    const track = pick(tracks, lang);
    const words = await grab(track.baseUrl.replace(/\\u0026/g, '&'));
    if (words.length) return json({
      ok: true, kind: track.kind === 'asr' ? 'asr' : 'manual', lang: track.languageCode || '', client: used,
      ...meta, duration: meta.duration || words[words.length - 1].e, count: words.length, words
    });
  }

  for (const l of ['pt', 'pt-BR', 'en']) {
    for (const kind of ['', '&kind=asr']) {
      const tu = 'https://www.youtube.com/api/timedtext?lang=' + l + '&v=' + id + '&fmt=json3' + kind;
      const r = await race(fetch(tu, { headers: { 'user-agent': UA, cookie: COOKIE, referer: 'https://www.youtube.com/' } }), 6000);
      if (!r || !r.ok) continue;
      const body = await r.text();
      if (!body || body.trim()[0] !== '{') continue;
      try {
        const words = fromJson3(JSON.parse(body));
        if (words.length) return json({ ok: true, kind: kind ? 'asr' : 'manual', lang: l, client: 'TIMEDTEXT', ...meta, count: words.length, words });
      } catch {}
    }
  }

  return json({ ok: false, ...meta, error: tracks.length ? 'A faixa de legenda existe mas retornou vazia.' : 'Este vídeo não tem legendas disponíveis.' }, 404);
};

export const config = { path: '/api/transcript', name: 'transcript' };
