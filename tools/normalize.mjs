#!/usr/bin/env node
/* normalize.mjs · 确定性归一：字段枚举、吉凶档位、别名去重
 *
 * 只做「明确可判定」的修正，不改写任何断语内容：
 *   tg  常见同义写法 → 枚举值（人际关系 → 人际）
 *   g   超出 -2..2 的取值 → 夹紧
 *   nm  去除与主键相同的别名、去重、去空、超 12 项截断（上限放宽到 12，避免静默削掉用户的真实说法）
 *   sc  情境短语含标点 → 去除；重复情境 → 合并
 * 用法: node tools/normalize.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../data/', import.meta.url).pathname;
const dry = process.argv.includes('--dry');
const TG = ['财运', '事业', '感情', '健康', '人际', '心绪', '出行', '学业'];

// 同义 → 枚举（只收录明确等价的写法）
const TG_MAP = {
  '人际关系': '人际', '人脉': '人际', '社交': '人际', '人际交往': '人际', '人际关係': '人际',
  '情感': '感情', '爱情': '感情', '婚恋': '感情', '婚姻': '感情', '桃花': '感情',
  '情绪': '心绪', '心理': '心绪', '心境': '心绪', '精神状态': '心绪', '精神': '心绪',
  '工作': '事业', '职业': '事业', '前程': '事业', '运势': '事业', '名望': '事业',
  '钱财': '财运', '财富': '财运', '财': '财运', '金钱': '财运', '生意': '财运',
  '学习': '学业', '考试': '学业', '求知': '学业', '智慧': '学业', '灵感': '学业',
  '身体': '健康', '身心': '健康', '养生': '健康', '平安': '健康',
  '旅行': '出行', '交通': '出行', '走动': '出行', '迁移': '出行', '变动': '出行',
};

let changed = 0;
const report = { tg: 0, g: 0, nm: 0, sc: 0, files: 0 };

for (const f of readdirSync(DIR).filter(x => x.endsWith('.json')).sort()) {
  let arr;
  try { arr = JSON.parse(readFileSync(join(DIR, f), 'utf8')); }
  catch (e) { console.log(`  跳过未完成 ${f}`); continue; }
  if (!Array.isArray(arr)) continue;
  let touched = false;

  for (const e of arr) {
    // tg 归一
    if (Array.isArray(e.tg)) {
      const mapped = [];
      for (const t of e.tg) {
        const v = TG.includes(t) ? t : TG_MAP[t];
        if (v && !mapped.includes(v)) mapped.push(v);
      }
      if (mapped.length && JSON.stringify(mapped) !== JSON.stringify(e.tg)) { e.tg = mapped.slice(0, 3); report.tg++; touched = true; }
    } else { e.tg = ['心绪']; report.tg++; touched = true; }

    // g 夹紧
    const g0 = Number(e.g);
    const g1 = Number.isFinite(g0) ? Math.max(-2, Math.min(2, Math.round(g0))) : 0;
    if (g1 !== e.g) { e.g = g1; report.g++; touched = true; }

    // nm 清理
    if (!Array.isArray(e.nm)) e.nm = [];
    const nm = [];
    for (const a of e.nm) {
      if (typeof a !== 'string') continue;
      const s = a.trim();
      if (!s || s === e.k || nm.includes(s)) continue;
      nm.push(s);
    }
    const nm2 = nm.slice(0, 12);
    if (JSON.stringify(nm2) !== JSON.stringify(e.nm)) { e.nm = nm2; report.nm++; touched = true; }

    // sc 清理：去标点、去重、补全字段
    if (Array.isArray(e.sc)) {
      const seen = new Set();
      const sc = [];
      for (const s of e.sc) {
        if (!s || typeof s.s !== 'string' || typeof s.v !== 'string') continue;
        const key = s.s.replace(/[，。、；：？！\s]/g, '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        sc.push({ s: key.length > 14 ? key.slice(0, 14) : key, v: s.v.trim() });
      }
      if (sc.length && JSON.stringify(sc) !== JSON.stringify(e.sc)) { e.sc = sc; report.sc++; touched = true; }
    }
  }

  if (touched) {
    changed++;
    report.files++;
    console.log(`  ${f.padEnd(15)} 已归一`);
    if (!dry) writeFileSync(join(DIR, f), JSON.stringify(arr));
  }
}

console.log(`\n修改文件 ${report.files} 个｜tg ${report.tg} 处｜g ${report.g} 处｜nm ${report.nm} 处｜sc ${report.sc} 处${dry ? '（dry-run）' : ''}`);
