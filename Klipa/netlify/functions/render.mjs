// ============================================
// ARQUIVO 6 de 6  ·  render.mjs
// Salvar em: klipa/netlify/functions/render.mjs
// Função: Render HD no servidor com ffmpeg (opcional)
// ============================================

import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const FORMATS = {
  tiktok: { w: 1080, h: 1920 }, reels: { w: 1080, h: 1920 }, shorts: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 }, portrait: { w: 1080, h: 1350 }
};

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'JSON inválido.' }, 400); }

  const { id, in: tin, out: tout, ass, format = 'shorts', quality = '1080', title = 'corte' } = body || {};
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return json({ ok: false, error: 'ID inválido.' }, 400);
  const start = Math.max(0, Number(tin) || 0);
  const dur = Math.max(1, Math.min(180, (Number(tout) || 0) - start));
  const F = FORMATS[format] || FORMATS.shorts;
  const scale = Math.min(1, (Number(quality) || 1080) / 1080);
  const W = Math.round((F.w * scale) / 2) * 2, H = Math.round((F.h * scale) / 2) * 2;

  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), 'klipa-'));
    const assPath = join(dir, 'corte.ass');
    await writeFile(assPath, String(ass || '').replace(/\r/g, ''), 'utf8');

    let ytdl;
    try { ytdl = (await import('@distube/ytdl-core')).default; }
    catch { return json({ ok: false, error: 'Dependência @distube/ytdl-core ausente no deploy.' }, 500); }

    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${id}`, {
      requestOptions: { headers: { 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+419' } }
    }).catch((e) => { throw new Error('yt-dlp: ' + (e?.message || 'bloqueado')); });

    const fmt = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' })
      || ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
    if (!fmt) throw new Error('Nenhum formato disponível.');

    const vf = [
      `split=2[bg][fg]`,
      `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=26[b]`,
      `[fg]scale=${W}:-2[f]`,
      `[b][f]overlay=(W-w)/2:(H-h)*0.40[v]`,
      `[v]ass=${assPath.replace(/\\/g, '/').replace(/:/g, '\\:')}[out]`
    ].join(';');

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(start), '-t', String(dur), '-i', fmt.url,
      '-filter_complex', vf, '-map', '[out]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
      '-movflags', '+faststart+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'
    ];

    const chunks = [];
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stdout.on('data', (d) => chunks.push(d));
      p.stderr.on('data', (d) => { err += d.toString().slice(0, 400); });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve(c) : reject(new Error(err || 'ffmpeg saiu com código ' + c))));
      setTimeout(() => { try { p.kill('SIGKILL'); } catch {} reject(new Error('Tempo de render excedido.')); }, 110000);
    });

    const buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error('Render vazio.');
    const name = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36) || 'corte';
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-disposition': `attachment; filename="${name}_${format}_hd.mp4"`,
        'content-length': String(buf.length),
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 502);
  } finally {
    if (dir) { try { await rm(dir, { recursive: true, force: true }); } catch {} }
  }
};

export const config = { path: '/api/render', name: 'render' };