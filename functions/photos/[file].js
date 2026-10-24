export async function onRequestGet({ env, params }) {
  const id = String(params.file).replace(/\.jpg$/, '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('not found', { status: 404 });
  const row = await env.DB.prepare('SELECT p.data FROM photos p JOIN events e ON e.id = p.id WHERE p.id = ? AND e.hidden = 0').bind(id).first();
  if (!row) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(row.data), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
}
