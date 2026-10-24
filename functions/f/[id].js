// 功能獨立頁 /f/<id>
export const onRequestGet = ({ request, env }) => env.ASSETS.fetch(new URL('/', request.url));
