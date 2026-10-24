/* _middleware.js · 唯一入口收敛：*.pages.dev → https://useai.us.ci
   页面的 pages.dev 子域物理上无法删除（Pages 项目固有属性），
   用中间件把它降级为纯 301 跳转——内容与 SEO 上只存在 useai.us.ci 一个地址。
   /api/ 放行不跳转：301 会把 POST 降级成 GET、跨域重定向还会触发
   Origin 校验拒绝——放行可保住旧标签页的 AI 功能直到用户刷新。 */
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  if (url.hostname.endsWith('.pages.dev') && !url.pathname.startsWith('/api/')) {
    return Response.redirect('https://useai.us.ci' + url.pathname + url.search, 301);
  }
  return next();
}
