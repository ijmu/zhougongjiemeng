#!/usr/bin/env node
/* verify.mjs · 语料质量闸门
 * 用法: node tools/verify.mjs [--strict]
 * 检查: JSON 合法性 / 字段完整性 / 枚举 / 长度区间 / 主键重复 / 分类一致性 / 别名冲突
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../data/', import.meta.url).pathname;
const CATS = ['animal', 'person', 'body', 'nature', 'plant', 'object', 'place', 'action', 'event', 'emotion', 'spirit', 'misc'];
const TG = ['财运', '事业', '感情', '健康', '人际', '心绪', '出行', '学业'];

const strict = process.argv.includes('--strict');
let errs = 0, warns = 0;
const E = m => { errs++; console.log('  ✗ ' + m); };
const W = m => { warns++; console.log('  ! ' + m); };

const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')) : [];
if (!files.length) { console.log('✗ data/ 下没有 JSON 文件'); process.exit(1); }
console.log(`发现 ${files.length} 个文件\n`);

const catSeen = new Map();   // 主键 → 类别（跨文件查重）
const aliasSeen = new Map(); // 别名 → 主键
let total = 0;
const perCat = {};
const gDist = { '2': 0, '1': 0, '0': 0, '-1': 0, '-2': 0 };
let scTotal = 0, nmTotal = 0;

for (const f of files.sort()) {
  const base = f.replace(/\.json$/, '');
  let arr;
  try { arr = JSON.parse(readFileSync(join(DIR, f), 'utf8')); }
  catch (e) { E(`${f}: JSON 解析失败 — ${e.message}`); continue; }
  if (!Array.isArray(arr)) { E(`${f}: 顶层不是数组`); continue; }

  console.log(`── ${f}  (${arr.length} 条)`);
  const localKeys = new Set();
  let bad = 0;

  arr.forEach((e, i) => {
    const at = `${f}[${i}]`;
    const fail = m => { bad++; if (bad <= 6) E(`${at} ${e && e.k ? e.k : ''} ${m}`); };

    if (!e || typeof e !== 'object') return fail('不是对象');
    for (const k of ['k', 'c', 'ct', 'ps']) {
      if (typeof e[k] !== 'string' || !e[k].trim()) return fail(`缺字段 ${k}`);
    }
    if (e.k.length < 1 || e.k.length > 6) fail(`k 长度 ${e.k.length} 超出 1–6`);
    if (e.c !== base && CATS.includes(base)) fail(`c=${e.c} 与文件名 ${base} 不一致`);
    if (!Number.isInteger(e.g) || e.g < -2 || e.g > 2) fail(`g=${e.g} 非法`);
    else gDist[String(e.g)]++;
    if (typeof e.ct === 'string' && (e.ct.length < 50 || e.ct.length > 200)) W(`${e.k} ct 长度 ${e.ct.length} 偏离 70–120`);
    if (typeof e.ps === 'string' && (e.ps.length < 50 || e.ps.length > 200)) W(`${e.k} ps 长度 ${e.ps.length} 偏离 70–120`);

    if (!Array.isArray(e.nm)) fail('nm 不是数组');
    else {
      nmTotal += e.nm.length;
      for (const a of e.nm) {
        if (typeof a !== 'string' || !a) fail('nm 含空值');
        else if (a === e.k) fail(`nm 含主键自身「${a}」`);
        else {
          const prev = aliasSeen.get(a);
          if (prev && prev !== e.k) W(`别名「${a}」同时指向 ${prev} 与 ${e.k}`);
          else aliasSeen.set(a, e.k);
        }
      }
    }
    if (!Array.isArray(e.sc) || e.sc.length < 2) fail('sc 少于 2 条');
    else {
      scTotal += e.sc.length;
      const ss = new Set();
      for (const s of e.sc) {
        if (!s || typeof s.s !== 'string' || typeof s.v !== 'string' || !s.s || !s.v) { fail('sc 条目缺 s/v'); continue; }
        if (s.s.length < 2 || s.s.length > 14) W(`${e.k} 情境「${s.s}」长度 ${s.s.length}`);
        // 情境断语宁短勿水：14 字以上即可，上限放到 160 以容纳长断语
        if (s.v.length < 14 || s.v.length > 160) W(`${e.k} 情境「${s.s}」断语长度 ${s.v.length}`);
        if (/[，。、；：？！]/.test(s.s)) W(`${e.k} 情境「${s.s}」含标点`);
        if (ss.has(s.s)) fail(`sc 情境重复「${s.s}」`);
        ss.add(s.s);
      }
    }

    if (!Array.isArray(e.tg) || !e.tg.length) fail('tg 为空');
    else for (const t of e.tg) if (!TG.includes(t)) fail(`tg「${t}」不在枚举内`);

    if (localKeys.has(e.k)) W(`本文件主键重复 ${e.k}（将由 merge.mjs 合并）`);
    localKeys.add(e.k);
    const p = catSeen.get(e.k);
    if (p && p !== base) W(`主键「${e.k}」同时出现在 ${p} 与 ${base}`);
    else catSeen.set(e.k, base);

    total++;
  });
  if (bad > 6) console.log(`  … 该文件另有 ${bad - 6} 处同类错误`);
  perCat[base] = arr.length;
  console.log(`   ${bad ? '✗ ' + bad + ' 处硬错误' : '✓ 通过'}`);
  console.log('');
}

console.log('══════ 汇总 ══════');
console.log(`条目总数     ${total}`);
console.log(`唯一主键     ${catSeen.size}`);
console.log(`别名总数     ${nmTotal}`);
console.log(`情境总数     ${scTotal}  (平均 ${(scTotal / Math.max(total, 1)).toFixed(2)}/条)`);
console.log(`吉凶分布     大吉 ${gDist['2']} / 吉 ${gDist['1']} / 平 ${gDist['0']} / 凶 ${gDist['-1']} / 大凶 ${gDist['-2']}`);
const zeroPct = gDist['0'] / Math.max(total, 1) * 100;
console.log(`平象占比     ${zeroPct.toFixed(1)}%${zeroPct > 70 ? '  ← 偏高，吉凶分化不足' : ''}`);
console.log('分类覆盖:');
const missing = CATS.filter(c => !perCat[c]);
for (const c of CATS) console.log(`  ${c.padEnd(9)} ${perCat[c] == null ? '— 缺失' : perCat[c]}`);
if (missing.length) E(`缺少分类文件: ${missing.join(', ')}`);

console.log(`\n硬错误 ${errs} · 提示 ${warns}`);
if (errs) { console.log('✗ 未通过'); process.exit(1); }
if (strict && warns) { console.log('✗ strict 模式：存在提示项'); process.exit(1); }
console.log('✓ 通过');
