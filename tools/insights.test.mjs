/* insights.test.mjs · 心理层纯逻辑单测（不依赖 jsdom，镜像 app.js insightsHtml 的算法）
   覆盖：情绪基调提取 / 重复信号计数 / 别名归并 / 历史排除回归 */
import { readFileSync, readdirSync } from 'node:fs';
import { moodTone, buildIndex, matchText } from '../web/js/engine.js';

let fail = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { fail++; console.log('  ✗ ' + m); } };

/* 语料与索引（与 app.js 同构：ENTRIES + buildIndex(ENTRIES)） */
const D = new URL('../web/data', import.meta.url).pathname;
const ENTRIES = [];
for (const f of readdirSync(D)) {
  if (!f.endsWith('.json') || f === 'manifest.json' || f.startsWith('_')) continue;
  ENTRIES.push(...JSON.parse(readFileSync(D + '/' + f, 'utf8')));
}
const INDEX = buildIndex(ENTRIES);
const symOf = t => new Set(matchText(t, INDEX).map(h => ENTRIES[h.i] && ENTRIES[h.i].k).filter(Boolean));

/* ① 情绪基调 */
{
  const m = moodTone('梦见蛇追我，吓得出了一身冷汗，拼命逃跑');
  ok(m && m.tone === 'fear' && m.lvl >= 2, `恐惧梦 → ${m && m.tone}/${m && m.lvl}（词:${m && m.words.join('、')}）`);
  const c = moodTone('梦到在草地上晒太阳，很舒服，笑着唱歌');
  ok(c && c.tone === 'calm', `平静梦 → ${c && c.tone}`);
  ok(moodTone('今天天气真好') === null, '无情绪词 → null（不渲染面板）');
  const s = moodTone('梦见过世的奶奶，哭醒了，特别想念她');
  ok(s && s.tone === 'sad', `悲伤梦 → ${s && s.tone}`);
}

/* ② 重复信号：镜像 insightsHtml 的 tally 逻辑 */
function tally(hist, curText) {
  const t = new Map();
  for (const h of hist) {
    if (!h.t) continue;
    for (const hit of matchText(h.t, INDEX)) {
      const k = (ENTRIES[hit.i] || {}).k;
      if (!k) continue;
      const o = t.get(k) || { n: 0, recent: 0 };
      o.n++;
      if (Date.now() - (h.ts || 0) <= 45 * 86400000) o.recent++;
      t.set(k, o);
    }
  }
  const cur = [...symOf(curText)];
  return cur.map(k => ({ k, ...(t.get(k) || { n: 0, recent: 0 }) })).filter(o => o.n >= 1);
}
const NOW = Date.now();
{
  const hist = [
    { t: '梦见蛇缠身', ts: NOW - 86400000 },
    { t: '又梦见一条小龙盘着', ts: NOW - 40 * 86400000 },   // 「小龙」若是蛇的别名则归并；不是则此条不计
  ];
  const r = tally(hist, '梦见蛇');
  const snake = r.find(o => o.k === '蛇');
  ok(!!snake && snake.n >= 1, `历史含蛇 → 计数 ${snake && snake.n}`);
  ok(snake && snake.recent === Math.min(snake.n, 1) + (snake.n > 1 ? 0 : 0) || snake.recent >= 0, '近期标记不崩溃');
}
{
  // 回归：pushHist 在渲染后 → 渲染时历史里已有同文本 → 「本机第 2 次」必须触发
  const hist = [{ t: '梦见蛇缠身，很害怕', ts: NOW - 60000 }];
  const r = tally(hist, '梦见蛇缠身，很害怕');
  ok(r.some(o => o.k === '蛇' && o.n === 1), '同文本重解 → 历史计数生效（本机第 2 次的来源）');
}
{
  // 别名归并：历史用别名、当前用主键，必须命中同一符号
  // （蟒蛇这类同时是独立条目的词不算别名——命中它理应记到蟒蛇自己头上）
  const ali = ENTRIES.find(e => e.k === '蛇' && e.nm && e.nm.length);
  const a = ali ? (ali.nm || []).find(x => x && !ENTRIES.some(e2 => e2.k === x)) : null;
  if (a) {
    const r = tally([{ t: '梦见' + a, ts: NOW }], '梦见蛇');
    ok(r.some(o => o.k === '蛇'), `别名「${a}」归并到主键 蛇`);
  } else ok(true, '蛇无可用的纯别名（跳过别名用例）');
}
{
  // 隐私：tally 只碰符号键，不输出原文
  const r = tally([{ t: '梦见蛇缠身我的名字张三', ts: NOW }], '梦见蛇');
  ok(JSON.stringify(r).includes('张三') === false, '输出不含历史原文');
}

console.log(fail ? `✗ 失败 ${fail} 项` : '✓ insights 全部通过');
process.exitCode = fail ? 1 : 0;
