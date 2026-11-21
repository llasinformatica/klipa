// ARQUIVO 3 · transcribe-background.mjs · klipa/netlify/functions/transcribe-background.mjs
// Função BACKGROUND (até 15min): baixa o áudio do YouTube e transcreve com Whisper
// palavra a palavra. Grava o progresso em Netlify Blobs para o front consultar.
import { getStore } from '@netlify/blobs';

const KEY = process.env.KLIPA_AI_KEY || process.env.OPENAI_API_KEY;
const store = getStore('klipa-jobs');

const set = (job, obj) => store.setJSON(job, obj).catch(() => {});

async function downloadBuffer(url, maxBytes) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok || !r.body) throw new Error('download falhou (' + r.status + ')');
  const reader = r.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > maxBytes) { reader.cancel(); throw new Error('áudio maior que o limite de 25MB do Whisper'); }
  }
  const out = new Uint8Array(size); let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch {}
  const { id, lang = 'auto', job } = body || {};
  if (!job) return new Response('ok', { status: 202 });
  await set(job, { stage: 'fetching', pct: 5 });

  if (!KEY) { await set(job, { stage: 'error', error: 'KEY_MISSING' }); return new Response('ok', { status: 202 }); }

  let ytdl;
  try { ytdl = (await import('@distube/ytdl-core')).default; }
  catch { await set(job, { stage: 'error', error: 'ytdl-core ausente no deploy' }); return new Response('ok', { status: 202 }); }

  try {
    const info = await ytdl.getInfo('https://www.youtube.com/watch?v=' + id, {
      requestOptions: { headers: { 'accept-language': 'pt-BR,pt;q=0.9', cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+419' } }
    });
    const vd = info.videoDetails || {};
    const fmt = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio', filter: 'audioonly' })
      || ytdl.chooseFormat(info.formats, { quality: 'lowest' });
    if (!fmt) throw new Error('sem formato de áudio');
    await set(job, { stage: 'fetching', pct: 15, title: vd.title, author: vd.author, duration: Number(vd.lengthSeconds || 0) });

    const buf = await downloadBuffer(fmt.url, 25 * 1024 * 1024);
    await set(job, { stage: 'transcribing', pct: 45, title: vd.title, author: vd.author, duration: Number(vd.lengthSeconds || 0) });

    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: fmt.container === 'webm' ? 'audio/webm' : 'audio/mp4' }), 'audio.' + (fmt.container === 'webm' ? 'webm' : 'm4a'));
    fd.append('model', 'whisper-1');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    fd.append('timestamp_granularities[]', 'segment');
    if (lang && lang !== 'auto') fd.append('language', lang);

    const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + KEY },
      body: fd
    });
    const wj = await wr.json();
    if (!wr.ok) throw new Error(wj?.error?.message || ('Whisper HTTP ' + wr.status));

    const words = (wj.words || []).map(w => ({ w: String(w.word || '').trim(), s: +w.start, e: +w.end })).filter(w => w.w);
    await set(job, {
      stage: 'done', pct: 100,
      words, lang: wj.language || lang,
      title: vd.title, author: vd.author,
      duration: Number(vd.lengthSeconds || 0) || (words.length ? words[words.length - 1].e : 0)
    });
  } catch (e) {
    await set(job, { stage: 'error', error: String(e?.message || e) });
  }
  return new Response('ok', { status: 202 });
};

export const config = { path: '/api/transcribe-background', name: 'transcribe-background', schedule: undefined };