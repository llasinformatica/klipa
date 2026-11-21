// ARQUIVO 5 · ai.mjs · klipa/netlify/functions/ai.mjs
// Usa a mesma chave para refinar a análise: título de gancho, razão do score e emoji.
const KEY = process.env.KLIPA_AI_KEY || process.env.OPENAI_API_KEY;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'use POST' }, 405);
  if (!KEY) return json({ ok: false, error: 'KEY_MISSING' }, 500);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: 'json inválido' }, 400); }
  const cuts = (b.cuts || []).slice(0, 8);
  if (!cuts.length) return json({ ok: true, picks: [] });
  const lang = b.lang || 'pt';
  const prompt =
    'Você é editor de vídeos virais. Para cada corte abaixo (texto transcrito + score preliminar), responda SOMENTE um JSON válido no formato ' +
    '{"picks":[{"title":string,"reason":string,"emoji":string,"score":number}]} na mesma ordem. ' +
    'title = gancho de até 6 palavras em ' + lang + ' (caixa alta opcional, sem clickbait falso). ' +
    'reason = 1 frase curta explicando por que viraliza. emoji = 1 emoji relevante. score = 0-100 inteiro.\n\nCORTES:\n' +
    cuts.map((c, i) => (i + 1) + '. [' + Math.round(c.in) + 's-' + Math.round(c.out) + 's] score=' + c.score + ' texto="' + String(c.text || '').slice(0, 400) + '"').join('\n');
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: process.env.KLIPA_AI_MODEL || 'gpt-4o-mini',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: 'Responda apenas JSON.' }, { role: 'user', content: prompt }]
      })
    });
    const j = await r.json();
    if (!r.ok) return json({ ok: false, error: j?.error?.message || ('HTTP ' + r.status) }, 502);
    const content = j?.choices?.[0]?.message?.content || '{}';
    let parsed; try { parsed = JSON.parse(content); } catch { return json({ ok: false, error: 'resposta não-JSON' }, 502); }
    const picks = (parsed.picks || []).map(p => ({
      title: String(p.title || '').slice(0, 60),
      reason: String(p.reason || '').slice(0, 160),
      emoji: String(p.emoji || '').slice(0, 4),
      score: Number.isFinite(+p.score) ? Math.max(0, Math.min(100, Math.round(+p.score))) : undefined
    }));
    return json({ ok: true, picks });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 502);
  }
};
export const config = { path: '/api/ai', name: 'ai' };