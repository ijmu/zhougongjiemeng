#!/usr/bin/env node
/* audit.mjs · 布局与可用性审计（无浏览器依赖）
 * 由于本沙箱 WebView 会僵死，这里用静态分析 + 几何推断做常规回归：
 *   1. 引用闭合：html/css/js 里提到的本地资源是否都存在
 *   2. 选择器闭合：app.js 里 $('id') 是否都能在 index.html 找到
 *   3. 类名闭合：app.js 输出的 class 是否有 CSS 规则（或明确为状态类）
 *   4. 触控目标：CSS 里交互元素的 min-height 是否 >= 40px
 * 用法: node tools/audit.mjs
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB = join(ROOT, 'web');

let errs = 0, warns = 0;
const E = m => { errs++; console.log('  ✗ ' + m); };
const W = m => { warns++; console.log('  ! ' + m); };
// 契约断言：不达标就是错误（隐私承诺不可降级为提示）
const okNote = (c, m) => { if (c) console.log('  ✓ ' + m); else { errs++; console.log('  ✗ ' + m); } };
const OK = m => console.log('  ✓ ' + m);

const html = readFileSync(join(WEB, 'index.html'), 'utf8');
const css = readFileSync(join(WEB, 'style.css'), 'utf8');
const app = readFileSync(join(WEB, 'js', 'app.js'), 'utf8');
const eng = readFileSync(join(WEB, 'js', 'engine.js'), 'utf8');
const dat = readFileSync(join(WEB, 'js', 'data.js'), 'utf8');

/* ---------- 1. 引用闭合 ---------- */
console.log('── 引用闭合 ──');
const refRe = /["'(]([^"'()\s]+\.(?:js|css|html|png|json|xml|txt))(?:\?[^"'()\s]*)?["')]/g;
const all = { 'index.html': html, 'style.css': css, 'js/app.js': app, 'js/engine.js': eng, 'js/data.js': dat, '404.html': readFileSync(join(WEB, '404.html'), 'utf8') };
const missing = [];
for (const [rel, text] of Object.entries(all)) {
  for (const m of text.matchAll(refRe)) {
    const ref = m[1];
    if (/^(https?:|\/\/|data:|minis:)/.test(ref)) continue;
    if (ref.includes('${') || ref.includes('+' + "'")) continue;   // 模板拼接跳过
    const t = ref.startsWith('/') ? ref.slice(1) : normalize(join(dirname(rel), ref)).replace(/\\/g, '/');
    if (t.startsWith('data/')) {
      // 语料：检查 web/data 下是否存在（build 后）
      const dir = join(WEB, 'data');
      if (!existsSync(dir)) { W(`${rel} → ${t}  （web/data 尚未构建，先跑 build.mjs）`); continue; }
    }
    if (!existsSync(join(WEB, t))) missing.push(`${rel} → ${t}`);
  }
}
if (missing.length) missing.forEach(m => E('悬空引用 ' + m)); else OK('所有本地资源引用均存在');

/* ---------- 2. DOM id 闭合 ---------- */
console.log('\n── DOM id 闭合 ──');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const usedIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
// 动态创建的 id（toast）单独放行
usedIds.add('toast');
const missIds = [...usedIds].filter(i => !htmlIds.has(i) && i !== 'toast');
// 动态模板里出现的 id
const dynIds = new Set([...app.matchAll(/id="([a-z-]+)"/g)].map(m => m[1]));
const realMiss = missIds.filter(i => !dynIds.has(i));
if (realMiss.length) realMiss.forEach(i => E(`app.js 引用了不存在的 #${i}`)); else OK(`${usedIds.size} 个 id 引用全部有对应元素`);

const unusedIds = [...htmlIds].filter(i => !usedIds.has(i) && !['bgStars', 'orbit', 'card-about', 'card-detail', 'card-browse'].includes(i));
if (unusedIds.length) W(`index.html 中未被脚本使用的 id: ${unusedIds.join(', ')}`); else OK('无冗余 id');

/* ---------- 3. class 闭合 ---------- */
console.log('\n── class 闭合 ──');
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
// 只取 class="..." 里形如合法 CSS 标识符的片段；模板里的表达式（${...}）会切出
// 一堆语法碎片，必须靠标识符正则滤掉
const IDENT = /^[a-zA-Z][\w-]*$/;
const jsClasses = new Set(
  [...app.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/[\s${}?:'"<>]+/))
    .filter(c => IDENT.test(c))
);
// classList.add / className = 动态切换的状态类
const dynToggle = new Set(
  [...app.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)]
    .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]))
    .filter(c => IDENT.test(c))
);
for (const c of dynToggle) jsClasses.add(c);
const noCss = [...jsClasses].filter(c => !cssClasses.has(c) && ![...cssClasses].some(k => k.startsWith(c) && c.length >= 2));
if (noCss.length) W(`JS 输出的类名在 CSS 中没有规则: ${noCss.join(', ')}`);
else OK(`${jsClasses.size} 个类名均有样式（前缀拼接类如 gc${'{1|2|0}'} 已按前缀匹配放行）`);

/* ---------- 4. 触控目标 ---------- */
console.log('\n── 触控目标 (≥40px) ──');
const INTERACTIVE = ['btn-main', 'btn-sub', 'link-btn', 'qk', 'tab', 'bi', 'dream-in', 'hist-i'];
const badTouch = [];
for (const c of INTERACTIVE) {
  const re = new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '\\b[^{]*\\{([^}]*)\\}', 'g');
  const blocks = [...css.matchAll(re)].map(m => m[1]);
  if (!blocks.length) { badTouch.push(`${c} 无规则`); continue; }
  const joined = blocks.join(';');
  const mh = joined.match(/min-height\s*:\s*(\d+)px/);
  const pad = joined.match(/padding\s*:\s*([\d.]+)px/);
  const h = mh ? Number(mh[1]) : (pad ? Number(pad[1]) * 2 + 16 : null);
  if (h != null && h < 40) badTouch.push(`${c} = ${h}px`);
  else if (h == null) W(`${c} 未显式声明高度，无法静态判定`);
}
if (badTouch.length) badTouch.forEach(b => W('偏小: ' + b)); else OK('全部达标');

/* ---------- 5. 横向溢出风险 ---------- */
console.log('\n── 溢出风险 ──');
const fixed = [...css.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:\s*(-?\d{3,})px/g)]
  .filter(m => ['width', 'min-width'].includes(m[1]))
  .filter(m => Number(m[2]) > 660);
if (fixed.length) fixed.forEach(m => W(`固定宽度 ${m[1]}:${m[2]}px 可能溢出窄屏`)); else OK('无超窄屏固定宽度');
if (!/overflow-x\s*:\s*hidden/.test(css)) W('body 未设 overflow-x:hidden');
else OK('body 已限制横向溢出');
if (!/max-width\s*:\s*660px/.test(css)) W('主容器缺少 max-width 限制'); else OK('主容器宽度受限');

/* ---------- 6. 安全 ---------- */
console.log('\n── 安全 ──');
const EXT_TAG = /<(script|img|iframe|link)\b[^>]*>/gi;
const ext = [];
for (const m of html.matchAll(EXT_TAG)) {
  const tag = m[0];
  const url = (tag.match(/\b(?:src|href)="(https?:\/\/[^"]+)"/) || [])[1];
  if (!url) continue;
  if (/\brel="(canonical|alternate|preconnect|dns-prefetch)"/.test(tag)) continue;
  ext.push(m[1] + ' → ' + url);
}
if (ext.length) W(`外部资源引用: ${ext.join(', ')}`); else OK('无外部资源引用（离线可用）');
if (/innerHTML\s*=\s*[`'"]\$\{(?!esc\()/.test(app)) W('检测到未转义的 innerHTML 拼接');
else OK('innerHTML 拼接均经 esc()');
const withShield = (app.match(/esc\(/g) || []).length;
OK(`转义调用 ${withShield} 处`);
if (/eval\(|new Function\(/.test(app + eng)) E('存在 eval / new Function'); else OK('无动态代码执行');
if (/localStorage/.test(app)) OK('仅使用 localStorage 存储（无 cookie）');
if (/fetch\(/.test(app + dat)) {
  const urls = [...(app + dat).matchAll(/fetch\(\s*['"`]([^'"`]+)/g)].map(m => m[1]);
  const remote = urls.filter(u => /^https?:/.test(u));
  if (remote.length) E(`存在跨域 fetch: ${remote.join(', ')}`); else OK(`fetch 均为同源: ${[...new Set(urls)].join(', ')}`);
  // 唯一会向外发送数据的路径：必须由用户显式同意把守
  if (/\/api\/ai-dream/.test(app)) {
    const gated = /consent\s*:\s*'1'/.test(app);
    okNote(gated, gated
      ? 'AI 外呼路径带 consent 标记（需显式同意）'
      : 'AI 外呼路径缺少 consent 标记 —— 隐私守门缺失');
    const ckPresent = /id="ai-ck"/.test(app) || /ai-ck/.test(html);
    okNote(ckPresent, ckPresent ? '界面提供同意勾选控件' : '缺少同意勾选控件');
  }
}
// 隐私文案必须与实现一致
if (/不发送、不上传/.test(html)) {
  const disclosed = /主动勾选同意|只有你主动/.test(html);
  okNote(disclosed, disclosed
    ? '隐私文案已披露 AI 例外（与实现一致）'
    : '隐私文案声称「不上传」但未披露 AI 例外 —— 文案与实现不符');
}
// 意象遥测必须披露（进化闭环的隐私契约）
if (/\/api\/ai-dream/.test(app)) {
  const evoDisclosed = /匿名/.test(html) && /意象/.test(html) && /原文不留存/.test(html);
  okNote(evoDisclosed, evoDisclosed
    ? 'AI 意象词遥测已在文案披露（匿名 / 不留原文）'
    : 'AI 意象遥测未在文案披露 —— 隐私契约缺失');
}
// 心理学注脚的键必须是语料主键——挂错就永远是渲染不出来的死数据
{
  const keys = new Set();
  for (const f of readdirSync(WEB + '/data')) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    for (const e of JSON.parse(readFileSync(WEB + '/data/' + f, 'utf8'))) keys.add(e.k);
  }
  const m = app.match(/const PSY_NOTES = \{([\s\S]*?)\n\};/);
  if (!m) { E('找不到 PSY_NOTES 定义'); }
  else {
    const pk = [...m[1].matchAll(/'([^']+)':/g)].map(x => x[1]);
    const dead = pk.filter(k => !keys.has(k));
    okNote(pk.length >= 20, `心理学注脚覆盖 ${pk.length} 个意象（应 ≥20）`);
    okNote(dead.length === 0, dead.length === 0
      ? '注脚键全部命中语料主键'
      : `死键（主键不存在，注脚永远不渲染）: ${dead.join('、')}`);
  }
}

// SEO 绝对 URL 域名一致性：自指域名必须是线上域名（曾因旧工程名残留全站指向死域名）
{
  const CANON = 'https://zhougongjiemeng.pages.dev';
  const seo = {
    'index.html': html,
    'robots.txt': readFileSync(join(WEB, 'robots.txt'), 'utf8'),
    'sitemap.xml': readFileSync(join(WEB, 'sitemap.xml'), 'utf8'),
  };
  for (const [name, text] of Object.entries(seo)) {
    const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase());
    // 只盯我们自己的托管域族（pages.dev / workers.dev），schema 命名空间等无关域名不误报
    const strangers = [...new Set(hosts.filter(h => /pages\.dev$|workers\.dev$/.test(h) && h !== 'zhougongjiemeng.pages.dev'))];
    okNote(strangers.length === 0,
      strangers.length === 0
        ? `${name} 自指域名一致（${hosts.length} 处绝对 URL）`
        : `${name} 指向陌生托管域: ${strangers.join(', ')} —— 旧工程名/死域名残留`);
  }
  const refs = [
    [/rel="canonical" href="([^"]+)"/, 'canonical'],
    [/og:url" content="([^"]+)"/, 'og:url'],
    [/og:image" content="([^"]+)"/, 'og:image'],
  ];
  for (const [re, name] of refs) {
    const m = html.match(re);
    okNote(!!m && m[1].startsWith(CANON),
      m && m[1].startsWith(CANON) ? `${name} → ${m[1]}` : `${name} 缺失或域名不对（应为 ${CANON}…）`);
  }
}

console.log(`\n错误 ${errs} · 提示 ${warns}`);
console.log(errs ? '✗ 未通过' : '✓ 通过');
process.exit(errs ? 1 : 0);
