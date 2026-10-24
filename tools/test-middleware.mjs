#!/usr/bin/env node
/* test-middleware.mjs · 唯一入口收敛中间件的行为回归 */
import { onRequest } from '../functions/_middleware.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const SENTINEL = new Response('NEXT');
const next = async () => SENTINEL;
const run = (url) => onRequest({ request: new Request(url), next, env: {} });

let r = await run('https://zhougongjiemeng.pages.dev/');
ok(r.status === 301 && r.headers.get('location') === 'https://useai.us.ci/',
  `pages.dev 根 → 301 useai（实际 ${r.status} ${r.headers.get('location')}）`);

r = await run('https://zhougongjiemeng.pages.dev/data/animal.json?a=1');
ok(r.status === 301 && r.headers.get('location') === 'https://useai.us.ci/data/animal.json?a=1',
  '子路径+查询串保留');

r = await run('https://zhougongjiemeng.pages.dev/api/ai-dream');
ok(r === SENTINEL, 'pages.dev /api/* → 放行（不降级 POST、不触 Origin 拒绝）');

r = await run('https://useai.us.ci/');
ok(r === SENTINEL, '主域名 → 放行');

r = await run('https://evil.pages.dev.example.com/');
ok(r === SENTINEL, '伪后缀域名（.pages.dev.example.com）→ 不误跳');

console.log(fail ? `✗ 失败 ${fail} 项` : '✓ middleware 全部通过');
process.exitCode = fail ? 1 : 0;
