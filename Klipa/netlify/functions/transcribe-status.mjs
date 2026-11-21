// ARQUIVO 4 · transcribe-status.mjs · klipa/netlify/functions/transcribe-status.mjs
import { getStore } from '@netlify/blobs';
const store = getStore('klipa-jobs');

export default async (req) => {
  const job = new URL(req.url).searchParams.get('job') || '';
  if (!job) return new Response(JSON.stringify({ stage: 'error', error: 'job ausente' }), { status: 400 });
  const data = await store.getJSON(job).catch(() => null);
  return new Response(JSON.stringify(data || { stage: 'pending' }), {
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
  });
};
export const config = { path: '/api/transcribe-status', name: 'transcribe-status' };