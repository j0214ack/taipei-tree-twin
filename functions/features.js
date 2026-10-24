// 單一入口：功能目錄
export const onRequestGet = ({ request, env }) => env.ASSETS.fetch(new URL('/', request.url));
