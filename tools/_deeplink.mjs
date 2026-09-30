#!/usr/bin/env node
/* _deeplink.mjs · 深链测试（单独进程运行）
 *
 * 为什么单独跑：jsdom 的 DOM 实例很吃内存，如果在 e2e.mjs 里再建第二个实例，
 * 沙箱 node 默认上限会被 OOM 杀掉。放子进程里，测完随进程释放。
 * 以 __DL__{json} 的形式输出一行结果给调用方解析。
 */
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WEB = new URL('../web/', import.meta.url).pathname;
const q = process.argv[2] || '梦见蛇';
const bundlePath = process.argv[3];

const DATA = {};
for (const f of readdirSync(join(WEB, 'data'))) {
  if (f.endsWith('.json')) DATA[f] = readFileSync(join(WEB, 'data', f), 'utf8');
}
const html = readFileSync(join(WEB, 'index.html'), 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');

const dom = new JSDOM(html, {
  url: 'https://jiemeng.pages.dev/?q=' + encodeURIComponent(q),
  pretendToBeVisual: true,
});
const w = dom.window;
w.Element.prototype.scrollIntoView = () => {};

const G = globalThis;
for (const [n, v] of [['window', w], ['document', w.document], ['navigator', w.navigator],
  ['location', w.location], ['localStorage', w.localStorage]]) {
  Object.defineProperty(G, n, { value: v, writable: true, configurable: true });
}
G.fetch = async (url) => {
  const k = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').split('?')[0].replace(/^data\//, '');
  if (!DATA[k]) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  return { ok: true, status: 200, json: async () => JSON.parse(DATA[k]), text: async () => DATA[k] };
};
G.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);

const out = { q, ok: false };
try {
  await import('file://' + bundlePath + '?t=' + Date.now());
  const t0 = Date.now();
  for (;;) {
    const r = w.document.getElementById('result');
    if (r && r.innerHTML.length > 500) break;
    if (Date.now() - t0 > 150000) break;
    await new Promise(res => setTimeout(res, 150));
  }
  const d = w.document;
  const res = d.getElementById('result');
  out.input = d.getElementById('dream').value;
  out.resultLen = res.innerHTML.length;
  out.emptyShown = /梦书未录此象/.test(res.textContent);
  const g = res.querySelector('.vgrade');
  out.grade = g ? g.textContent : '';
  out.symbols = [...res.querySelectorAll('.sym-h b')].map(b => b.textContent);
  out.ok = out.resultLen > 500;
} catch (e) {
  out.error = e.message;
}
process.stdout.write('__DL__' + JSON.stringify(out) + '\n');
process.exit(0);
