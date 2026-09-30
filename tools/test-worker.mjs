#!/usr/bin/env node
/* test-worker.mjs · 用 Node 直接跑 Worker 产物，验证路由/头/缓存/404
 * 用法: node tools/test-worker.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const P = new URL('../dist/worker.mjs', import.meta.url).pathname;
const mod = await import(pathToFileURL(P).href);
const worker = mod.default;

let fail = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { fail++; console.log('  ✗ ' + m); } };

async function hit(path, method = 'GET') {
  const req = new Request('https://jiemeng.pages.dev' + path, { method, redirect: 'manual' });
  return worker.fetch(req);
}

console.log('── 基本路由 ──');
let r = await hit('/');
ok(r.status === 200, `GET / → ${r.status}`);
let t = await r.text();
ok(t.includes('<title>周公解梦'), '首页返回真实 HTML');
ok(r.headers.get('content-type').startsWith('text/html'), 'Content-Type text/html');

r = await hit('/style.css');
ok(r.status === 200 && r.headers.get('content-type').startsWith('text/css'), `GET /style.css → ${r.status} ${r.headers.get('content-type')}`);
ok(r.headers.get('cache-control').includes('max-age=300'), `CSS 缓存头: ${r.headers.get('cache-control')}`);

r = await hit('/js/app.js');
ok(r.status === 200 && r.headers.get('content-type').includes('javascript'), `GET /js/app.js → ${r.status}`);

r = await hit('/data/nature.json');
ok(r.status === 200 && r.headers.get('content-type').includes('json'), `GET /data/nature.json → ${r.status}`);
ok(r.headers.get('cache-control').includes('max-age=3600'), `数据缓存头: ${r.headers.get('cache-control')}`);

r = await hit('/og.png');
ok(r.status === 200 && r.headers.get('content-type') === 'image/png', `GET /og.png → ${r.status}`);

console.log('\n── 安全头 ──');
r = await hit('/');
const need = ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy', 'content-security-policy'];
for (const h of need) ok(!!r.headers.get(h), `存在 ${h}`);
const csp = r.headers.get('content-security-policy');
ok(/script-src 'self' 'sha256-/.test(csp), 'CSP 用 sha256 哈希而非 unsafe-inline');
ok(!csp.includes('unsafe-inline') || !/script-src[^;]*unsafe-inline/.test(csp), 'script-src 无 unsafe-inline');
r = await hit('/og.png');
ok(!r.headers.get('content-security-policy'), '图片响应不带 CSP（仅文档类需要）');

console.log('\n── 规范 URL 跳转 ──');
r = await hit('/index.html');
ok(r.status === 308 && r.headers.get('location').endsWith('/'), `/index.html → ${r.status} ${r.headers.get('location')}`);
r = await hit('/404.html');
ok(r.status === 308 && r.headers.get('location').endsWith('/404'), `/404.html → ${r.status} ${r.headers.get('location')}`);

console.log('\n── 404 与 SPA 行为 ──');
r = await hit('/nonexistent-page');
ok(r.status === 404, `错误链接 → ${r.status}`);
t = await r.text();
ok(t.includes('此路不通'), '返回自定义 404 页面（而非 SPA 回落到首页）');
r = await hit('/js/nope.js');
ok(r.status === 404, `不存在的 js → ${r.status}`);

console.log('\n── 方法限制 ──');
r = await hit('/', 'POST');
ok(r.status === 405 && r.headers.get('allow') === 'GET, HEAD', `POST / → ${r.status}`);
r = await hit('/', 'HEAD');
ok(r.status === 200, `HEAD / → ${r.status}`);
const body = await r.text();
ok(body === '', 'HEAD 无响应体');

console.log('\n── 内容完整性 ──');
const localIndex = readFileSync(new URL('../web/index.html', import.meta.url).pathname);
r = await hit('/');
const buf = Buffer.from(await (await r.arrayBuffer()));
ok(Buffer.compare(buf, localIndex) === 0, `首页与本地逐字节一致（${buf.length} bytes）`);

for (const p of ['/js/engine.js', '/js/app.js', '/js/data.js', '/style.css', '/404']) {
  const resp = await hit(p);
  const b = Buffer.from(await resp.arrayBuffer());
  const raw = readFileSync(new URL('../web' + (p === '/404' ? '/404.html' : p), import.meta.url).pathname);
  ok(Buffer.compare(b, raw) === 0, `${p} 逐字节一致`);
}

console.log(`\n${fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过'}`);
process.exit(fail ? 1 : 0);
