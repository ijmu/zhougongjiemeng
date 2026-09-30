#!/usr/bin/env node
/* repair.mjs · 语料容错修复
 *
 * 为什么需要：大 JSON 由多次写入拼成时，极易留下残尾（少一个逗号、缺结尾括号、
 * 最后一条被截断）。直接 JSON.parse 会整批报废，但实际只有最后一两条是坏的。
 *
 * 做法：括号配平扫描出所有「完整的顶层对象」，逐个 JSON.parse，丢掉坏的、留下好的，
 * 再重新序列化成规范数组。不做任何"猜内容"的修补，只做确定性打捞。
 *
 * 用法: node tools/repair.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../data/', import.meta.url).pathname;
const dry = process.argv.includes('--dry');

/** 扫描出所有顶层 `{...}` 片段（正确处理字符串与转义） */
function scanObjects(s) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; }
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

const REQUIRED = ['k', 'c', 'ct', 'ps'];

let fixed = 0;
const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.json')).sort() : [];
if (!files.length) { console.log('data/ 下没有 JSON'); process.exit(1); }

for (const f of files) {
  const p = join(DIR, f);
  const raw = readFileSync(p, 'utf8').trim();
  if (!raw) { console.log(`${f.padEnd(16)} 空文件，跳过`); continue; }

  let arr = null;
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) arr = j;
    else if (j && typeof j === 'object') arr = [j];
  } catch (e) { /* 走打捞路径 */ }

  if (arr) {
    // 已是合法数组：只清理不合格条目
    const good = arr.filter(e => e && typeof e === 'object' && REQUIRED.every(k => typeof e[k] === 'string' && e[k].trim()));
    if (good.length !== arr.length) {
      console.log(`${f.padEnd(16)} 解析正常，剔除 ${arr.length - good.length} 条残缺项 → ${good.length}`);
      if (!dry) writeFileSync(p, JSON.stringify(good));
      fixed++;
    } else {
      console.log(`${f.padEnd(16)} ✓ 合法  ${arr.length} 条`);
    }
    continue;
  }

  // 打捞
  const frags = scanObjects(raw);
  const objs = [];
  let bad = 0;
  for (const fr of frags) {
    try {
      const o = JSON.parse(fr);
      if (o && typeof o === 'object' && REQUIRED.every(k => typeof o[k] === 'string' && o[k].trim())) objs.push(o);
      else bad++;
    } catch (e) { bad++; }
  }
  if (!objs.length) { console.log(`${f.padEnd(16)} ✗ 无法打捞（${frags.length} 片段全部残缺）`); continue; }

  console.log(`${f.padEnd(16)} 打捞成功 ${objs.length} 条，丢弃 ${bad} 条残片`);
  if (!dry) {
    renameSync(p, p + '.broken');
    writeFileSync(p, JSON.stringify(objs));
    console.log(`${' '.repeat(16)} 原文件另存为 ${f}.broken`);
  }
  fixed++;
}

console.log(`\n${fixed ? '修复 ' + fixed + ' 个文件' : '全部无需修复'}${dry ? '（dry-run，未落盘）' : ''}`);
