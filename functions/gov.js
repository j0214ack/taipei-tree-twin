// 角色路徑：回傳首頁 HTML（網址不變，前端依路徑切角色）
export const onRequestGet = ({ request, env }) => env.ASSETS.fetch(new URL('/', request.url));
