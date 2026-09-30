#!/usr/bin/env node
/* bundle-classic.mjs · 把三个 ES module 合成一个传统脚本，供 jsdom 端到端测试注入
 *
 * 为什么需要：jsdom 完全不支持 ES module。为了能在命令行真跑页面逻辑（沙箱 WebView 会僵死），
 * 这里按依赖顺序把 engine.js → data.js → app.js 拼起来，剥掉 import/export 语法。
 * 只做确定性的语法改写，不改任何逻辑。产物仅用于测试，不参与部署。
 * 用法: node tools/bundle-classic.mjs [输出路径]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = new URL('../web/', import.meta.url).pathname;
const ORDER = ['js/engine.js', 'js/data.js', 'js/app.js'];
const OUT = process.argv[2] || '/tmp/jiemeng-classic.js';

const parts = [];
parts.push('/* 自动生成，勿手改：由 tools/bundle-classic.mjs 从 web/js/*.js 合并 */');
parts.push('(function(){');

for (const rel of ORDER) {
  let s = readFileSync(join(WEB, rel), 'utf8');
  // 去掉 import 语句（含多行形式）
  s = s.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  // 去掉 export 关键字（保留声明本身）
  s = s.replace(/^\s*export\s+(const|let|var|function|class|async)\b/gm, '$1');
  s = s.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  s = s.replace(/^\s*export\s+default\s+/gm, 'var __default = ');
  parts.push(`\n/* ===== ${rel} ===== */\n`);
  parts.push(s.trim());
  parts.push('\n');
}

parts.push('})();');
const out = parts.join('\n');
writeFileSync(OUT, out);

// 静态自检：不该再有 import/export
const bad = [...out.matchAll(/^\s*(import|export)\b/gm)].map(m => m[0].trim());
if (bad.length) { console.error('✗ 仍残留 ' + bad.length + ' 处 import/export'); process.exit(1); }
console.log(`✓ ${ORDER.join(' + ')} → ${OUT}  (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB)`);
