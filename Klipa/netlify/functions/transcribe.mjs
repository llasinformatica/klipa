// ARQUIVO 2 · transcribe.mjs · klipa/netlify/functions/transcribe.mjs
// Inicia (sync, rápido) um job de transcrição Whisper em background.
export default async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get('probe')) {
    return new Response(JSON.stringify({ ok: true, hasKey: !!(process.env.KLIPA_AI_KEY || process.env.OPENAI_API_KEY) }),
      { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  }
  const id = (u.searchParams.get('id') || '').trim();
  const lang = (u.searchParams.get('lang') || 'auto').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return new Response(JSON.stringify({ ok: false, error: 'ID inválido' }), { status: 400 });
  const job = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const base = process.env.URL || process.env.DEPLOY_URL || '';
  try {
    await fetch(base + '/.netlify/functions/transcribe-background', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, lang, job })
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'falha ao enfileirar: ' + e.message }), { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true, job }),
    { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
};
export const config = { path: '/api/transcribe', name: 'transcribe' };