#!/usr/bin/env node
/*
  e2e.mjs · 真实页面的端到端测试（jsdom + 经典脚本打包）

  为什么这么做：本沙箱 WebView 打开页面必然僵死（已知环境缺陷），
  而 jsdom 能真跑 index.html 的 DOM、事件与页面逻辑，等价于无头浏览器点一遍。
  ES module 由 tools/bundle-classic.mjs 合成经典脚本注入。

  覆盖：启动加载 → 输入提示 → 解梦主流程 → 结果渲染 → 翻梦书 → 详情 → 历史 → 深链 → 注入防御
*/
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, existsSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB = join(ROOT, 'web');
const BUNDLE = '/tmp/jiemeng-classic.js';

let fail = 0;
import * as fs from 'node:fs';
const PROG = '/tmp/e2e-progress.log';
const T0 = Date.now();
const mark = m => { const t = `[${((Date.now()-T0)/1000).toFixed(1)}s rss=${Math.round(process.memoryUsage().rss/1048576)}MB] ${m}\n`; fs.writeSync(2, t); try { appendFileSync(PROG, t); } catch(e){} };
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { fail++; console.log('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 沙箱 node 以 --jitless 运行，定时器精度差、DOM 更新常在 2–3s 后；
   固定 sleep 会不稳，统一改成轮询等待条件成立 */
async function until(fn, timeout = 12000, step = 120) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = !!fn(); } catch (e) { /* 元素还没出现 */ }
    if (v) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
}

console.log('── 准备 ──');
/* 进程内打包：execFileSync 嵌套 node 在本沙箱会被 SIGKILL（jitless + 僵尸进程 + 内存限制） */
{
  const ORDER = ['js/engine.js', 'js/data.js', 'js/app.js'];
  const parts = ['(function(){'];
  for (const rel of ORDER) {
    let t = readFileSync(join(WEB, rel), 'utf8');
    t = t.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
    t = t.replace(/^\s*export\s+(const|let|var|function|class|async)\b/gm, '$1');
    t = t.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
    t = t.replace(/^\s*export\s+default\s+/gm, 'var __default = ');
    parts.push('\n/* ===== ' + rel + ' ===== */\n', t.trim(), '\n');
  }
  parts.push('})();');
  writeFileSync(BUNDLE, parts.join('\n'));
}
const bundle = readFileSync(BUNDLE, 'utf8');
const BUNDLE2 = '/tmp/jiemeng-classic-dl.mjs';
writeFileSync(BUNDLE2, bundle);
ok(bundle.length > 20000, `测试脚本已生成（${(bundle.length / 1024).toFixed(1)} KB）`);

/* 语料截断：沙箱 node 是 --jitless（无 JIT），jsdom 在解释器下极慢极吃内存，
   全量 1045 条会让 new JSDOM() 被 OOM 杀掉。e2e 验证的是 DOM 接线与事件，
   与语料规模无关，故每类取前 18 条（约 200 条）足够覆盖。 */
const CAP = Number(process.env.E2E_CAP || 18);
const DATA = {};
for (const f of readdirSync(join(WEB, 'data'))) {
  if (!f.endsWith('.json') || f === 'manifest.json') continue;
  const arr = JSON.parse(readFileSync(join(WEB, 'data', f), 'utf8'));
  DATA[f] = JSON.stringify(arr.slice(0, CAP));
}
ok(Object.keys(DATA).length >= 3, `本地语料 ${Object.keys(DATA).length} 个文件可用于 fetch shim`);

/* ---------- 组装 jsdom ----------
 * 不能用 runScripts:'dangerously' —— 沙箱的 node 以 --jitless 启动，
 * jsdom 建 vm 上下文时 vm.runInContext('WebAssembly') 必抛 ReferenceError。
 * 绕法：jsdom 只提供 DOM，脚本在本 realm 里跑，全局对象逐个接过去。
 */
const html = readFileSync(join(WEB, 'index.html'), 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');
const jsErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => jsErrors.push(e.message));

const dom = new JSDOM(html, {
  url: 'https://zhougongjiemeng.pages.dev/',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const win = dom.window;
const doc = win.document;
const $ = id => doc.getElementById(id);

const G = globalThis;
const savedGlobals = {};
function inject(name, value) {
  const d = Object.getOwnPropertyDescriptor(G, name);
  savedGlobals[name] = d;
  try {
    Object.defineProperty(G, name, { value, writable: true, configurable: true, enumerable: true });
  } catch (e) {
    console.log('  ! 无法注入全局 ' + name + '：' + e.message);
  }
}
function restoreGlobals() {
  for (const [name, d] of Object.entries(savedGlobals)) {
    if (d) Object.defineProperty(G, name, d);
  }
}

inject('window', win);
inject('document', doc);
inject('navigator', win.navigator);
inject('location', win.location);
inject('localStorage', win.localStorage);
inject('sessionStorage', win.sessionStorage);
inject('Event', win.Event);
inject('CustomEvent', win.CustomEvent);
inject('HTMLElement', win.HTMLElement);
inject('Element', win.Element);
inject('Node', win.Node);
inject('NodeList', win.NodeList);
inject('getComputedStyle', win.getComputedStyle.bind(win));
inject('requestAnimationFrame', cb => setTimeout(() => cb(Date.now()), 16));
inject('cancelAnimationFrame', id => clearTimeout(id));
inject('scrollTo', () => {});
win.Element.prototype.scrollIntoView = () => {};
win.scrollTo = () => {};

// fetch shim：从本地 web/data 读，等价于同源静态服务
G.fetch = async (url) => {
  const rel = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').split('?')[0];
  const key = rel.replace(/^data\//, '');
  if (!DATA[key]) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  const text = DATA[key];
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};


console.log('\n── 启动 ──'); mark('启动 开始'); mark('启动');
const bootRun = async () => {
  const t = Date.now();
  try {
    // 用临时文件 + 查询串破缓存（同一模块只能执行一次，深链复用需重新执行）
    writeFileSync('/tmp/jiemeng-boot-' + t + '.mjs', bundle);
    await import('file:///tmp/jiemeng-boot-' + t + '.mjs?t=' + t);
  } catch (e) { jsErrors.push('bundle: ' + e.message); }
};
await bootRun();
await until(() => $('browseCount').textContent && /\d/.test($('browseCount').textContent));
ok(win.__bootOK === true, '看门狗标志已置位（boot 执行成功）');
ok($('err').style.display !== 'block', '无启动错误提示');

const entries = win.__ENTRIES__ || null;
const browseCount = $('browseCount').textContent;
ok(/\d+/.test(browseCount), `翻梦书显示载入量：${browseCount}`);
ok($('dream').placeholder.includes('把梦见的写下来'), '输入框占位文案已切换为正式版（语料载入完成）');

console.log('\n── 输入实时提示 ──'); mark('输入实时提示 开始'); mark('输入实时提示');
const ta = $('dream');
const setVal = v => { ta.value = v; ta.dispatchEvent(new win.Event('input', { bubbles: true })); };

// 从真实语料里挑两条必然命中的符号，避免测试与语料内容耦合
const ALL = [];
for (const [f, t] of Object.entries(DATA)) {
  if (f === 'manifest.json') continue;
  try { const j = JSON.parse(t); if (Array.isArray(j)) ALL.push(...j); } catch (e) { /* skip */ }
}
const PICK = ALL.filter(e => e && typeof e.k === 'string' && e.k.length >= 2 && e.sc && e.sc.length >= 2);
const K1 = PICK[0].k, K2 = PICK[1].k;
const S1 = PICK[0].sc[0].s, S2 = PICK[1].sc[0].s;
ok(PICK.length > 50, `可测语料 ${PICK.length} 条（选用「${K1}」「${K2}」）`);

setVal('梦见' + K1 + '和' + K2);
await sleep(30);
ok(/认出/.test($('hitpre').textContent), `命中提示：${$('hitpre').textContent}`);
ok($('counter').textContent.startsWith(String(('梦见' + K1 + '和' + K2).length)), `字数计数：${$('counter').textContent}`);

setVal('今天天气真好');
await sleep(30);
ok(/暂未认出/.test($('hitpre').textContent), `未识别提示：${$('hitpre').textContent}`);

console.log('\n── 解梦主流程 ──'); mark('解梦主流程 开始'); mark('解梦主流程');
setVal('梦见' + K1 + '，' + S1 + '，还梦到' + K2);
const result = $('result');
$('go').click();
// 起卦动画 900ms + 文本长度加成，且沙箱定时器偏慢 → 轮询等结果落地
const settled = await until(() => result.innerHTML.length > 500 || /梦书未录此象/.test(result.textContent));
ok(settled, '解梦流程在超时前完成');

ok(result.innerHTML.length > 500, `结果已渲染（${result.innerHTML.length} 字符）`);
ok(/总断/.test(result.textContent), '存在「总断」区块');
ok(/逐象详解/.test(result.textContent), '存在「逐象详解」区块');
ok(/传统断语/.test(result.textContent), '包含传统断语');
ok(/心理象征/.test(result.textContent), '包含心理象征');
const syms = result.querySelectorAll('.sym');
ok(syms.length >= 2, `逐象卡片 ${syms.length} 张`);
const vnum = result.querySelector('.vnum b');
ok(vnum && /^\d+$/.test(vnum.textContent), `吉凶分显示为数字：${vnum && vnum.textContent}`);
ok(parseInt(vnum.textContent, 10) >= 1 && parseInt(vnum.textContent, 10) <= 99, '分数在 1–99 区间');
ok($('cast').hidden, '起卦动画已收起');
ok($('go').disabled === false, '按钮已恢复可用');
const grade = result.querySelector('.vgrade');
ok(grade && grade.textContent.length >= 2, `等级文案：${grade && grade.textContent}`);

console.log('\n── 情境判定 ──'); mark('情境判定 开始'); mark('情境判定');
const scene = result.querySelector('.sym-sc b');
ok(scene, `识别到情境：${scene && scene.textContent}`);
const winText = result.querySelector('.sym-w');
ok(winText && winText.querySelector('em'), '梦境原文中的命中词被高亮');

console.log('\n── 本机记录 ──'); mark('本机记录 开始'); mark('本机记录');
ok(!$('card-history').hidden, '历史卡片已显示');
const hi = $('hist-list').querySelectorAll('.hist-i');
ok(hi.length >= 1, `记录 ${hi.length} 条`);
const stored = JSON.parse(win.localStorage.getItem('zm_hist_v1') || '[]');
ok(stored.length >= 1 && stored[0].t.includes(K1), '记录内容正确写入 localStorage');

console.log('\n── 翻梦书 ──'); mark('翻梦书 开始'); mark('翻梦书');
$('browse').click();
await sleep(120);
ok(!$('card-browse').hidden, '梦书面板已展开');
const tabs = $('tabs').querySelectorAll('.tab');
ok(tabs.length >= 3, `分类标签 ${tabs.length} 个：${[...tabs].map(t => t.textContent.trim()).slice(0, 6).join(' / ')}`);
let bis = $('blist').querySelectorAll('.bi');
ok(bis.length > 10, `梦象格子 ${bis.length} 个`);

// 搜索
const bq = $('bq');
bq.value = K1;
bq.dispatchEvent(new win.Event('input', { bubbles: true }));
await sleep(80);
bis = $('blist').querySelectorAll('.bi');
ok(bis.length >= 1, `搜索「${K1}」→ ${bis.length} 个结果`);
ok([...bis].some(b => b.dataset.k === K1), `结果包含「${K1}」`);

// 点开详情
bis[0].click();
await sleep(80);
ok(!$('card-detail').hidden, '详情卡片已展开');
ok(/梦见/.test($('d-title').textContent), `详情标题：${$('d-title').textContent}`);
ok($('d-body').textContent.length > 120, `详情正文 ${$('d-body').textContent.length} 字`);
ok(/情境分述/.test($('d-body').textContent), '详情包含情境分述');
$('d-close').click();
ok($('card-detail').hidden, '详情可关闭');

console.log('\n── 分类切换 ──'); mark('分类切换 开始'); mark('分类切换');
const catTab = [...$('tabs').querySelectorAll('.tab')].find(t => !/全部/.test(t.textContent));
if (catTab) {
  catTab.click();
  await sleep(60);
  ok($('blist').querySelectorAll('.bi').length > 0, `切到「${catTab.textContent.trim()}」有内容`);
}

console.log('\n── 快捷词与随机梦 ──'); mark('快捷词与随机梦 开始'); mark('快捷词与随机梦');
const qks = $('quick').querySelectorAll('.qk');
ok(qks.length >= 5, `快捷词 ${qks.length} 个`);
qks[0].click();
await sleep(60);
ok(ta.value.includes('梦见'), `点击快捷词后输入框：${ta.value.slice(0, 20)}`);

$('clear').click();
await sleep(40);
ok(ta.value === '' && $('result').innerHTML === '', '清空按钮同时清掉输入与结果');

$('clear').click();
$('random').click();
await until(() => $('result').innerHTML.length > 500);
ok($('result').innerHTML.length > 0, '随机一梦有响应（不崩）');
/* 随机句在截断语料下可能无匹配（无匹配不写历史），故用一次确定匹配的解梦验证累积 */
setVal('梦见' + K2 + '，' + (PICK[1].sc && PICK[1].sc[0] ? PICK[1].sc[0].s : '') + '，还梦到' + K1);
$('go').click();
await until(() => $('result').innerHTML.length > 500);
const stored2 = JSON.parse(win.localStorage.getItem('zm_hist_v1') || '[]');
ok(stored2.length >= 2, `历史累积到 ${stored2.length} 条`);

console.log('\n── 异常输入 ──'); mark('异常输入 开始'); mark('异常输入');
$('clear').click();
setVal('   ');
$('go').click();
await sleep(200);
ok($('err').style.display === 'block' && /先写下/.test($('err').textContent), `空输入提示：${$('err').textContent}`);

setVal('啊');
$('go').click();
await sleep(200);
ok(/再多写一点/.test($('err').textContent), `过短输入提示：${$('err').textContent}`);

$('clear').click();
setVal('我昨天想的那个事情有点复杂');
$('go').click();
const nmOk = await until(() => /梦书未录此象/.test($('result').textContent));
ok(nmOk, '未识别时给出友好引导页');
const fillBtns = $('result').querySelectorAll('[data-fill]');
ok(fillBtns.length > 0, `引导页提供 ${fillBtns.length} 个可点的推荐梦象`);
// 产品契约（与语料规模无关）：未命中时必须至少给出一条兜底路径 —— 模糊建议 或 AI 补读
const hasSug = /你是不是想找/.test($('result').textContent);
const hasAI = /让 AI 再读一遍/.test($('result').textContent);
ok(hasSug || hasAI, `未命中时给出兜底路径（模糊建议=${hasSug} / AI 补读=${hasAI}）`);
const sugNames = [...$('result').querySelectorAll('.sug-block .sug-i b')].map(b => b.textContent);
if (hasSug) ok(sugNames.length > 0, `建议候选：${sugNames.slice(0, 6).join('、')}`);
else console.log('  · 语料截断下无模糊候选，AI 补读已覆盖该场景');
// AI 补读入口：默认不可用（必须显式同意），这是隐私契约的界面侧体现
const aick = $('ai-ck'), aigo = $('ai-go');
ok(!!aick && !!aigo, '未命中页渲染出 AI 补读入口');
ok(aigo && aigo.disabled === true, 'AI 按钮默认禁用（未同意不可用）');
ok(/发送到服务器/.test($('result').textContent), '界面明确提示梦境将发送到服务器');
if (aick && aigo) {
  aick.checked = true;
  aick.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(aigo.disabled === false, '勾选同意后 AI 按钮解锁');
}
// 点一个建议应能直接出结果（无候选时跳过，由 AI 路径覆盖）
// 只点「确定存在于当前（可能截断的）语料里」的建议，避免截断导致的假失败
const known = new Set(PICK.map(e => e.k));
const target = [...fillBtns].find(b => known.has(b.dataset.fill));
if (target) {
  const before = $('result').innerHTML;
  target.click();
  await until(() => $('result').innerHTML.length > 500 && $('result').innerHTML !== before);
  const after = $('result').innerHTML;
  ok(after !== before && !/梦书未录此象/.test($('result').textContent),
     `点击建议能直接出解梦结果（输入框=「${$('dream').value}」 len=${after.length}）`);
}

console.log('\n── 注入防御 ──'); mark('注入防御 开始'); mark('注入防御');
$('clear').click();
const XSS = '梦见' + K1 + '<img src=x onerror="window.__XSS=1">和' + K2 + '<script>window.__XSS2=1</script>';
setVal(XSS);
$('go').click();
await until(() => result.innerHTML.length > 500);
ok(win.__XSS !== 1 && win.__XSS2 !== 1, '注入脚本未执行');
const injected = result.querySelector('img, script');
ok(!injected, '恶意 HTML 未进入 DOM');
ok(result.textContent.includes('<img') || result.textContent.includes('&lt;'), '恶意文本被转义为纯文本显示');

console.log('\n── 历史回放 ──'); mark('历史回放 开始'); mark('历史回放');
$('clear').click();
await sleep(40);
const histItems = $('hist-list').querySelectorAll('.hist-i');
ok(histItems.length >= 1, `历史仍有 ${histItems.length} 条`);
histItems[0].click();
await until(() => $('result').innerHTML.length > 500);
ok($('result').innerHTML.length > 500, '点击历史记录能重新出结果');
ok(!!$('result').querySelector('.insights'), '「另一面」面板随结果渲染');
{
  const recEl = $('result').querySelector('.ins-rec');
  ok(!!recEl && /本机第 \d+ 次/.test(recEl.textContent),
    `重复信号面板：历史重解即触发，计数正确${recEl ? '（实际 ' + (recEl.textContent.match(/本机第 \d+ 次/g) || []).join('、') + '）' : '（无面板）'}`);
}
ok(!!document.getElementById('card-care') && /意象排演/.test(document.getElementById('card-care').textContent),
  '「梦与心理」模块就位（IRT 自助内容）');

/* 多角度专项：情绪基调（仅 +1 次渲染；重复信号并入下方历史回放断言，控内存） */
console.log('\n── 多角度：情绪 ──'); mark('多角度 开始'); mark('多角度');
setVal('梦见' + K1 + '，吓得出了一身冷汗，拼命逃跑');
$('go').click();
await until(() => $('result').innerHTML.length > 500);
ok(!!$('result').querySelector('.ins-mood'), '情绪基调面板（fear 词必中）');
ok(/紧张/.test($('result').querySelector('.ins-mood').textContent), '情绪解读文案正确');
ok(!!$('result').querySelector('.ins-care'), '强紧张时有通往「梦与心理」的入口');
const psyNote = $('result').querySelector('.sym-psy');
if (psyNote) ok(/注/.test(psyNote.textContent), '心理学注脚格式正确');
else ok(true, '本例符号无注脚（正常——注脚只覆盖常见意象）');

/* 深链：另行开子进程跑（jsdom 第二个 DOM 实例会把沙箱 node 撑爆） */
console.log('\n── 深链（子进程）──'); mark('深链 开始'); mark('深链');
try {
  const raw = execFileSync(process.execPath, [
    join(ROOT, 'tools/_deeplink.mjs'), '梦见' + K1, BUNDLE2,
  ], { encoding: 'utf8', timeout: 300000, maxBuffer: 8 << 20 });
  const line = raw.split('\n').find(l => l.startsWith('__DL__'));
  const j = line ? JSON.parse(line.slice(6)) : { ok: false, error: '无输出' };
  ok((j.input || '').includes(K1), `深链填入输入框：${j.input}`);
  ok(j.ok, `深链自动出结果（${j.resultLen} 字符）`);
  ok(!!j.grade && j.grade.length >= 2, `深链结果等级：${j.grade}`);
  ok(Array.isArray(j.symbols) && j.symbols.length > 0, `深链命中梦象：${(j.symbols || []).join('、')}`);
  if (j.error) console.log('    [诊断] ' + j.error);
} catch (e) {
  ok(false, '深链子进程执行失败：' + String(e.message).slice(0, 120));
}

mark('运行时错误');
console.log('\n── 运行时错误 ──');
ok(jsErrors.length === 0, jsErrors.length ? 'jsdom 错误: ' + jsErrors.slice(0, 3).join(' | ') : '无未捕获错误');

console.log(`\n${fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过'}`);
process.exit(fail ? 1 : 0);
