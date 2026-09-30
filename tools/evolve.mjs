#!/usr/bin/env node
/* evolve.mjs · 语料进化聚合：拉取线上意象遥测 → 与梦书差集比对 → 产出增补候选
 *
 * 闭环：未命中 → 用户同意 AI 补读 → AI 末行【意象】点名核心词 →
 *       Function 匿名计数进 KV(evo:<day>) → 本工具聚合 → 候选清单（人工过目后并入 data/）
 *
 * 用法:
 *   node tools/evolve.mjs                 # 聚合并输出报告 + data/_evolve-candidates.json
 *   node tools/evolve.mjs --min 5         # 只看累计 ≥5 次的意象（默认 2）
 *   node tools/evolve.mjs --days 30       # 只扫最近 30 天的 evo:<date> 键（默认全部）
 *
 * 隐私：KV 里只有意象词计数，没有任何梦境原文；候选不会自动并入梦书，必须人工审后放进 data/。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const KV_DEFAULT = 'db106a0e25964fcc873a3f38aa4d9694';   // RL 命名空间（与 Function 共用）
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MIN = Number(arg('--min', 2));
const DAYS = Number(arg('--days', 0)) || Infinity;

if (!TOKEN) { console.error('✗ 缺 CLOUDFLARE_API_TOKEN'); process.exit(1); }

async function cf(path) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch('https://api.cloudflare.com/client/v4' + path,
        { headers: { Authorization: 'Bearer ' + TOKEN } });
      return await r.json();
    } catch (e) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); }
  }
  throw new Error('CF API 不可达');
}

/* ① 找到账户与命名空间下的 evo:* 键 */
const acct = await cf('/accounts').then(d => d.result[0].id);
const base = `/accounts/${acct}/storage/kv/namespaces/${KV_DEFAULT}/keys?prefix=evo:`;
const keys = [];
let cursor = '';
for (;;) {
  const page = await cf(base + (cursor ? `&cursor=${cursor}` : ''));
  if (!page.success) { console.error('✗', JSON.stringify(page.errors).slice(0, 200)); process.exit(1); }
  keys.push(...(page.result || []).map(k => k.name));
  cursor = page.result_info?.cursor;
  if (!cursor) break;
}

const today = new Date();
const inRange = name => {
  const d = name.slice(4);                        // evo:YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (DAYS === Infinity) return true;
  const dt = (today - new Date(d)) / 86400000;
  return dt >= 0 && dt <= DAYS;
};

/* ② 逐键取值，聚合计数 */
const bag = {};
let days = 0;
for (const name of keys.filter(inRange).sort()) {
  const v = await cf(`/accounts/${acct}/storage/kv/namespaces/${KV_DEFAULT}/values/${encodeURIComponent(name)}`);
  if (!v.success) continue;
  days++;
  for (const [w, n] of Object.entries(v.result || {})) bag[w] = (bag[w] || 0) + Number(n) || 0;
}

/* ③ 与现有梦书差集：k 或别名已含的不再候选 */
const D = join(ROOT, 'data');
const have = [];
for (const f of readdirSync(D)) {
  if (!f.endsWith('.json') || f === 'manifest.json') continue;
  for (const e of JSON.parse(readFileSync(join(D, f), 'utf8'))) {
    have.push(e.k, ...(e.nm || []));
  }
}
const haveSet = new Set(have);

const rows = Object.entries(bag)
  .filter(([w, n]) => n >= MIN && !haveSet.has(w))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 40);

console.log(`遥测键 ${keys.filter(inRange).length} 天 · 意象词 ${Object.keys(bag).length} 个 · 门槛 ≥${MIN}`);
const covered = Object.entries(bag).filter(([w]) => haveSet.has(w)).length;
console.log(`已被梦书覆盖 ${covered} 个（说明闭环在自愈）· 候选 ${rows.length} 个：`);
for (const [w, n] of rows) console.log(`  ${String(n).padStart(4)}  ${w}`);

if (rows.length) {
  const cands = rows.map(([w, n]) => ({
    k: w, c: 'misc', g: 0,
    nm: [],
    ct: `【候选·遥测 ${n} 次·待审】`,
    ps: '',
    sc: [],
    tg: [],
  }));
  writeFileSync(join(ROOT, 'data', '_evolve-candidates.json'),
    JSON.stringify(cands, null, 1));
  console.log(`\n已写 data/_evolve-candidates.json —— 审阅后把条目并进对应分类文件，`);
  console.log(`补全 ct/ps/sc 字段，然后跑 sh tools/release.sh 走正常发版。切勿整文件直接合并。`);
} else {
  console.log('暂无达标候选 —— 闭环安静运行中。');
}
