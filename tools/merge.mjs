#!/usr/bin/env node
/* merge.mjs · 合并同类别分片 + 去重
 *
 * 子任务可能把同一类别拆成 animal_1.json / animal_2.json；不同类别也可能撞同一个主键
 * （如「鱼」既是 animal 也可能是 food 类）。
 * 规则：
 *   同类别内重复  → 保留信息更全的一条，落败方的别名并入，不丢检索能力
 *   跨类别同主键  → 并入高优先级类别的那一条（别名/情境/维度取并集），不产生怪名字
 * 用法: node tools/merge.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../data/', import.meta.url).pathname;
const dry = process.argv.includes('--dry');
const clean = process.argv.includes('--clean');

const CATS = ['animal', 'person', 'body', 'nature', 'plant', 'object', 'place', 'action', 'event', 'emotion', 'spirit', 'misc'];
// 主责优先级：具体名词类在前，抽象行为/杂项在后
const PRIORITY = ['animal', 'person', 'body', 'spirit', 'plant', 'nature', 'object', 'place', 'emotion', 'event', 'action', 'misc'];
const rank = c => { const i = PRIORITY.indexOf(c); return i < 0 ? 99 : i; };

const quality = e =>
  (Array.isArray(e.sc) ? e.sc.length : 0) * 1000 + (e.ct || '').length + (e.ps || '').length;

/* ── 1. 收集（含分片文件） ── */
const files = readdirSync(DIR).filter(f => f.endsWith('.json') && !f.endsWith('.broken')).sort();
const skipped = [];
const shards = [];
const groups = new Map();
for (const f of files) {
  const base = f.replace(/\.json$/, '').replace(/_[A-Za-z0-9]+$/, '');
  if (!CATS.includes(base)) { console.log(`  跳过未知分类文件 ${f}`); continue; }
  let arr;
  try { arr = JSON.parse(readFileSync(join(DIR, f), 'utf8')); }
  catch (e) { skipped.push(`${f}（JSON 不完整）`); continue; }
  if (!Array.isArray(arr)) { skipped.push(`${f}（顶层非数组）`); continue; }
  if (!groups.has(base)) groups.set(base, []);
  for (const e of arr) { e.c = base; groups.get(base).push(e); }
  // 分片文件：默认保留（子任务可能仍在追加），--clean 时才删
  if (/_([A-Za-z0-9]+)\.json$/.test(f)) { shards.push(f); if (clean && !dry) unlinkSync(join(DIR, f)); }
}

/* ── 2. 同类别内去重 ── */
let dupIn = 0;
const perCat = new Map();
for (const [cat, list] of groups) {
  const byKey = new Map();
  for (const e of list) {
    const prev = byKey.get(e.k);
    if (!prev) { byKey.set(e.k, e); continue; }
    dupIn++;
    const [win, lose] = quality(e) > quality(prev) ? [e, prev] : [prev, e];
    win.nm = [...new Set([...(win.nm || []), ...(lose.nm || [])])].filter(a => a && a !== win.k);
    byKey.set(e.k, win);
  }
  perCat.set(cat, [...byKey.values()]);
}

/* ── 3. 跨类别同主键：合并到高优先级类别 ── */
let cross = 0;
const ownerCat = new Map();
for (const cat of [...perCat.keys()].sort((a, b) => rank(a) - rank(b))) {
  for (const e of perCat.get(cat)) if (!ownerCat.has(e.k)) ownerCat.set(e.k, cat);
}
const byOwner = new Map(); // cat → Map(key → entry)
for (const cat of perCat.keys()) byOwner.set(cat, new Map());

for (const cat of perCat.keys()) {
  for (const e of perCat.get(cat)) {
    const boss = ownerCat.get(e.k);
    const target = byOwner.get(boss);
    const prev = target.get(e.k);
    if (!prev) {
      e.c = boss;
      target.set(e.k, e);
      continue;
    }
    if (prev === e) continue;
    // 合并：别名取并集、情境去重取并集、维度取并集、ct/ps 保留更长的
    cross++;
    prev.nm = [...new Set([...(prev.nm || []), ...(e.nm || [])])].filter(a => a && a !== prev.k);
    const seen = new Set((prev.sc || []).map(s => s.s));
    for (const s of e.sc || []) if (!seen.has(s.s)) { seen.add(s.s); (prev.sc = prev.sc || []).push(s); }
    if ((prev.sc || []).length > 8) prev.sc = prev.sc.slice(0, 8);
    prev.tg = [...new Set([...(prev.tg || []), ...(e.tg || [])])].slice(0, 3);
    if ((e.ct || '').length > (prev.ct || '').length) prev.ct = e.ct;
    if ((e.ps || '').length > (prev.ps || '').length) prev.ps = e.ps;
    console.log(`  跨类同键「${prev.k}」：${cat} 并入 ${boss}`);
  }
}

/* ── 4. 落盘（稳定排序，保证产物可复现） ── */
let total = 0;
console.log('');
for (const cat of CATS) {
  const m = byOwner.get(cat);
  if (!m || !m.size) continue;
  const list = [...m.values()].sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  total += list.length;
  const uniq = new Set(list.map(e => e.k)).size;
  console.log(`  ${(cat + '.json').padEnd(14)} ${String(list.length).padStart(4)} 条  唯一 ${uniq}  ${uniq === list.length ? '✓' : '✗ 仍有重复'}`);
  if (!dry) {
    // 统一字段顺序，便于 diff 与 sha256 稳定
    const slim = list.map(e => {
      const o = { k: e.k, c: e.c, g: e.g, ct: e.ct, ps: e.ps, sc: e.sc, tg: e.tg };
      if (e.nm && e.nm.length) o.nm = e.nm;
      return o;
    });
    writeFileSync(join(DIR, cat + '.json'), JSON.stringify(slim));
  }
}
console.log(`\n合计 ${total} 条｜同类合并 ${dupIn} 次｜跨类并入 ${cross} 次${dry ? '（dry-run，未落盘）' : ''}`);
if (shards.length) console.log(`分片文件 ${shards.length} 个${clean ? '（已删除）' : '（保留，用 --clean 清理）'}: ${shards.join(', ')}`);
if (skipped.length) console.log(`跳过 ${skipped.length} 个未完成文件: ${skipped.join(', ')}`);
