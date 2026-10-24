import { json, listEvents, createEvent } from '../_lib/common.js';

export async function onRequestGet({ request, env }) {
  const tree = new URL(request.url).searchParams.get('tree');
  return json(await listEvents(env, tree));
}

export async function onRequestPost({ request, env }) {
  try { return await createEvent(request, env); } catch (e) { console.error(e); return json({ error: 'server error' }, 500); }
}
