#!/usr/bin/env node
/* build.mjs · 把 data/ 语料同步到 web/data/，并生成合并索引与统计
 * 用法: node tools/build.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'data');
const OUT = join(ROOT, 'web', 'data');

if (!existsSync(SRC)) { console.error('✗ 缺少 data/ 目录'); process.exit(1); }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter(f => f.endsWith('.json')).sort();
let total = 0;
const stats = {};
const skipped = [];

for (const f of files) {
  const raw = readFileSync(join(SRC, f), 'utf8');
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { skipped.push(f); continue; }
  if (!Array.isArray(arr)) { skipped.push(f); continue; }

  // 压缩：去掉空字段，缩小体积（字段名已短，不再做键名映射以保证可读与可调试）
  const slim = arr.map(e => {
    const o = { k: e.k, c: e.c, g: e.g, ct: e.ct, ps: e.ps, sc: e.sc, tg: e.tg };
    if (e.nm && e.nm.length) o.nm = e.nm;
    return o;
  });

  writeFileSync(join(OUT, f), JSON.stringify(slim));
  total += slim.length;
  stats[f.replace(/\.json$/, '')] = slim.length;
  console.log(`  ${f.padEnd(14)} ${String(slim.length).padStart(4)} 条  ${(Buffer.byteLength(JSON.stringify(slim)) / 1024).toFixed(1)} KB`);
}

// 清理 OUT 中已不存在的文件
for (const f of readdirSync(OUT)) {
  if (f.endsWith('.json') && !files.includes(f)) { rmSync(join(OUT, f)); console.log(`  清除陈旧 ${f}`); }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ v: 1, total, cats: stats, built: new Date().toISOString().slice(0, 10) }));
console.log(`\n合计 ${total} 条，已写入 web/data/`);
if (skipped.length) console.log(`跳过 ${skipped.length} 个未完成文件: ${skipped.join(', ')}`);

/* 版本戳自维护：index.html 对入口资源带 ?v=，任何 js/css 内容变动自动换新戳。
   之前靠手改日期戳，改了代码忘了改戳 → 老用户最多多看 5 分钟旧代码（/js/* max-age=300）。 */
{
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256');
  const JS = join(ROOT, 'web', 'js');
  for (const f of readdirSync(JS).filter(f => f.endsWith('.js')).sort()) h.update(readFileSync(join(JS, f)));
  h.update(readFileSync(join(ROOT, 'web', 'style.css')));
  const stamp = h.digest('hex').slice(0, 10);
  const idxPath = join(ROOT, 'web', 'index.html');
  const html0 = readFileSync(idxPath, 'utf8');
  const html = html0
    .replace(/(js\/app\.js\?v=)[^"]+/g, '$1' + stamp)
    .replace(/(style\.css\?v=)[^"]+/g, '$1' + stamp);
  if (html !== html0) {
    writeFileSync(idxPath, html);
    console.log(`  版本戳 → ${stamp}`);
  } else {
    console.log(`  版本戳未变（${stamp.slice(0, 6)}…）`);
  }
  // version.json · 供长开标签页做更新自检（与 index.html 的 ?v= 同源同值）
  writeFileSync(join(ROOT, 'web', 'version.json'),
    JSON.stringify({ v: stamp, built: new Date().toISOString().slice(0, 10) }));
}
