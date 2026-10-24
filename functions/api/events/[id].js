// 管理刪除（隱藏）不當照片或回報：需帶 x-admin-key，金鑰放在 Pages 的加密環境變數 ADMIN_KEY
import { json } from '../../_lib/common.js';

export async function onRequestDelete({ request, env, params }) {
  if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const r = await env.DB.prepare('UPDATE events SET hidden = 1 WHERE id = ?').bind(params.id).run();
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(params.id).run();
  return json({ ok: r.meta.changes > 0 });
}
