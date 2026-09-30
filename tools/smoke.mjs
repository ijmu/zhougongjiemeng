#!/usr/bin/env node
/* smoke.mjs · 全面回归：语料 → 索引 → 匹配 → 解梦 → 渲染数据
 * 不依赖浏览器，直接跑真实语料，产出统计与样本
 * 用法: node tools/smoke.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex, interpret, searchEntries, DIM_KEYS, GRADE_META } from '../web/js/engine.js';

const DIR = new URL('../data/', import.meta.url).pathname;
let fail = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { fail++; console.log('  ✗ ' + m); } };

if (!existsSync(DIR)) { console.error('✗ 缺少 data/'); process.exit(1); }
const ENTRIES = [];
for (const f of readdirSync(DIR).filter(x => x.endsWith('.json')).sort()) {
  const arr = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  ENTRIES.push(...arr);
}
console.log(`载入 ${ENTRIES.length} 条语料\n`);

const IDX = buildIndex(ENTRIES);
ok(IDX.length > ENTRIES.length, `索引项 ${IDX.length} > 条目 ${ENTRIES.length}（别名生效）`);

/* --- 覆盖度：一批真实语料里的常见梦境，看能不能认出来 --- */
const CASES = [
  ['梦见一条蛇缠着我的腿', ['蛇']],
  ['梦到牙齿一颗颗掉下来满嘴是血', ['牙齿']],
  ['梦见发大水把家淹了', ['洪水']],
  ['梦见被人追着跑，腿迈不动', []],
  ['梦见在考试，一道题都不会', []],
  ['梦见自己会飞，飞过整座城市', []],
  ['梦见已故的爷爷坐在门口', []],
  ['梦见捡到很多钱', []],
  ['梦见我怀孕了', []],
  ['梦见在陌生的城市迷路', []],
  ['梦见头发一把把地掉', []],
  ['梦见和女朋友分手了', []],
  ['梦见中了大奖', []],
  ['梦见坐飞机去国外', []],
  ['梦见鬼压床动不了', []],
  ['梦见下大雪', []],
  ['梦见太阳很刺眼', []],
  ['梦见我妈生病了', []],
  ['梦见被人打了', []],
  ['梦见回到小时候住的老房子', []],
];

console.log('── 识别覆盖 ──');
let hit = 0;
const missList = [];
for (const [text, want] of CASES) {
  const r = interpret(text, ENTRIES, IDX);
  const got = r.items.map(x => x.entry.k);
  const okCase = r.matched > 0;
  if (okCase) hit++;
  else missList.push(text);
  if (want.length) {
    const okWant = want.every(w => got.includes(w));
    if (!okWant) { fail++; console.log(`  ✗ 「${text}」期望含 ${want.join('/')}，实得 ${got.join('/') || '无'}`); }
  }
}
const rate = (hit / CASES.length * 100).toFixed(0);
console.log(`  识别率 ${hit}/${CASES.length} = ${rate}%`);
if (+rate < 85) { fail++; console.log('  ✗ 识别率低于 85%'); } else console.log('  ✓ 识别率达标');
if (missList.length) console.log('  未识别: ' + missList.map(s => s.slice(0, 14)).join(' | '));

/* --- 吉凶分布 --- */
console.log('\n── 分数分布 ──');
const SAMPLE = 4000;
const grades = {};
const scores = [];
for (let i = 0; i < SAMPLE; i++) {
  const e = ENTRIES[Math.floor(Math.random() * ENTRIES.length)];
  const sc = e.sc && e.sc.length ? e.sc[Math.floor(Math.random() * e.sc.length)] : null;
  const text = '梦见' + e.k + (sc ? '，' + sc.s : '');
  const r = interpret(text, ENTRIES, IDX);
  if (!r.matched) continue;
  grades[r.grade] = (grades[r.grade] || 0) + 1;
  scores.push(r.score);
}
scores.sort((a, b) => a - b);
const n = scores.length;
const pct = p => scores[Math.min(n - 1, Math.floor(n * p))].toFixed(1);
console.log(`  样本 ${n}`);
console.log(`  分位  p5=${pct(0.05)} p25=${pct(0.25)} p50=${pct(0.5)} p75=${pct(0.75)} p95=${pct(0.95)}`);
console.log(`  均值  ${(scores.reduce((a, b) => a + b, 0) / n).toFixed(1)}`);
const order = ['S', 'A', 'B', 'C', 'D', 'E'];
console.log('  等级  ' + order.map(g => `${g} ${((grades[g] || 0) / n * 100).toFixed(1)}%`).join('  '));
ok(Object.keys(grades).length >= 4, `等级分布覆盖 ${Object.keys(grades).length} 档（≥4 才有区分度）`);
const sPct = (grades.S || 0) / n;
const ePct = (grades.E || 0) / n;
ok(sPct < 0.25, `S 档占比 ${(sPct * 100).toFixed(1)}% 未过度集中`);
ok(ePct < 0.35, `E 档占比 ${(ePct * 100).toFixed(1)}% 未过度集中`);

/* --- 维度分布 --- */
console.log('\n── 预兆维度分布 ──');
const dimCount = {};
for (let i = 0; i < 2000; i++) {
  const e = ENTRIES[Math.floor(Math.random() * ENTRIES.length)];
  for (const d of e.tg || []) dimCount[d] = (dimCount[d] || 0) + 1;
}
for (const d of DIM_KEYS) {
  const c = dimCount[d] || 0;
  const bar = '█'.repeat(Math.round(c / 400));
  console.log(`  ${d}  ${String(c).padStart(5)}  ${bar}`);
}
const dimsCovered = DIM_KEYS.filter(d => (dimCount[d] || 0) > 0).length;
ok(dimsCovered === DIM_KEYS.length, `${dimsCovered}/${DIM_KEYS.length} 个维度均有覆盖`);

/* --- 性能 --- */
console.log('\n── 性能 ──');
const texts = CASES.map(c => c[0]);
let t0 = process.hrtime.bigint();
for (let i = 0; i < 500; i++) for (const t of texts) interpret(t, ENTRIES, IDX);
let ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`  ${(500 * texts.length)} 次解梦耗时 ${ms.toFixed(0)}ms，单次 ${(ms / (500 * texts.length)).toFixed(2)}ms`);
ok(ms / (500 * texts.length) < 30, '单次解梦 < 30ms（移动端可接受）');

t0 = process.hrtime.bigint();
buildIndex(ENTRIES);
ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`  构建索引 ${ms.toFixed(0)}ms`);
ok(ms < 500, '索引构建 < 500ms');

/* --- 长文本 --- */
console.log('\n── 长文本 ──');
const long = CASES.map(c => c[0]).join('，然后') + '。';
const rl = interpret(long.slice(0, 300), ENTRIES, IDX);
ok(rl.matched > 5, `300 字长文命中 ${rl.matched} 象`);
ok(rl.summary.length > 0, '长文总断非空');

/* --- 检索 --- */
console.log('\n── 检索 ──');
for (const q of ['蛇', '牙', '水', '考试', '死']) {
  const rs = searchEntries(q, ENTRIES, 5);
  console.log(`  「${q}」→ ${rs.map(e => e.k).join('、')}`);
}
ok(searchEntries('蛇', ENTRIES).length > 0, '检索可用');

console.log(`\n${fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过'}`);
process.exit(fail ? 1 : 0);
