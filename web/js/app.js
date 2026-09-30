/* app.js · 周公解梦 · 界面与交互 */
import { loadAll, fileNames } from './data.js';
import {
  buildIndex, interpret, searchEntries, suggestEntries,
  CAT_LABEL, DIM_KEYS, GRADE_META, G_LABEL,
} from './engine.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HKEY = 'zm_hist_v1';
const SKEY = 'zm_stats_v1';

let ENTRIES = [];
let INDEX = [];
let current = null;
let busy = false;

/* ---------- 背景星点 ---------- */
function stars() {
  const box = $('bgStars');
  if (!box) return;
  let h = '';
  for (let i = 0; i < 62; i++) {
    const x = Math.random() * 100, y = Math.random() * 72;
    const big = Math.random() > 0.86;
    const op = (0.25 + Math.random() * 0.6).toFixed(2);
    h += `<i class="${big ? 'big' : ''}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;opacity:${op}"></i>`;
  }
  box.innerHTML = h;
}

/* ---------- 本机记录 ---------- */
function readHist() {
  try {
    const o = JSON.parse(localStorage.getItem(HKEY) || '[]');
    return Array.isArray(o) ? o : [];
  } catch (e) { return []; }
}
function pushHist(text, score, grade) {
  const list = readHist();
  list.unshift({ t: text.slice(0, 120), s: Math.round(score), g: grade, ts: Date.now() });
  try { localStorage.setItem(HKEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* ignore */ }
}
function clearHist() {
  try { localStorage.removeItem(HKEY); } catch (e) { /* ignore */ }
}

/* ---------- 起手 ---------- */
const QUICK = ['蛇', '掉牙', '洪水', '被人追', '考试', '死亡', '飞', '结婚', '迷路', '怀孕'];

const RANDOM_DREAMS = [
  '梦见一条大黑蛇从房梁上垂下来，我吓得不敢动',
  '梦到自己在考试，卷子上一道题都不会做，铃声响了还没写完',
  '梦见牙齿一颗颗掉下来，吐出来一把，满嘴是血',
  '梦见发大水，水一直涨到胸口，我拼命往高处爬',
  '梦见被人追着跑，腿却像灌了铅一样迈不动',
  '梦见自己会飞，飞过整座城市，风很大但很舒服',
  '梦见回到老家，屋子空空的，已故的爷爷坐在门口',
  '梦见参加自己的婚礼，却认不出新娘是谁',
  '梦见在陌生的城市里迷路，天黑了找不到回酒店的路',
  '梦见自己怀孕了，肚子一天天变大',
  '梦见天上全是乌云，突然劈下一道闪电打在我面前',
  '梦见捡到很多钱，塞满了口袋，醒来什么都没有',
  '梦见掉进水里，怎么也浮不上来',
  '梦见和已经绝交的朋友和好了，抱在一起哭',
  '梦见爬一座很高很陡的山，爬到一半没力气了',
  '梦见家里的猫一直对着墙角叫，那里什么都没有',
  '梦见头发大把大把地掉，镜子里自己变秃了',
  '梦见一场大火把房子烧光了，我却站在外面很平静',
];

function initQuick() {
  $('quick').innerHTML = QUICK.map(q => `<button class="qk" data-q="${esc(q)}">梦见${esc(q)}</button>`).join('');
  $('quick').addEventListener('click', e => {
    const b = e.target.closest('.qk');
    if (!b) return;
    const v = b.dataset.q;
    const ta = $('dream');
    ta.value = ta.value.trim() ? ta.value.trim() + '，还' + v : '梦见' + v;
    onInput();
    ta.focus();
  });
}

/* ---------- 输入 ---------- */
function onInput() {
  const v = $('dream').value;
  $('counter').textContent = v.length + ' / 300';
  const pre = $('hitpre');
  if (!v.trim() || !INDEX.length) {
    pre.className = 'chip ghost';
    pre.textContent = INDEX.length ? '等待输入' : '梦书载入中…';
    return;
  }
  const r = interpret(v, ENTRIES, INDEX);
  if (!r) return;
  if (!r.matched) {
    pre.className = 'chip warn';
    pre.textContent = '暂未认出梦象，可换更具体的说法';
  } else {
    pre.className = 'chip on';
    pre.textContent = `认出 ${r.matched} 个梦象：${r.items.slice(0, 4).map(x => x.entry.k).join('、')}${r.matched > 4 ? '…' : ''}`;
  }
}

/* ---------- 渲染：总断 ---------- */
const RING_COLOR = {
  S: '#4fd39b', A: '#8fd8b0', B: '#d9b877', C: '#d9b877', D: '#e88b6a', E: '#ec6f6f', none: '#7d84a4',
};

function renderVerdict(r) {
  const meta = GRADE_META[r.grade] || GRADE_META.none;
  const col = RING_COLOR[r.grade] || RING_COLOR.none;
  const dims = Object.keys(r.dims).length;

  const dimHtml = DIM_KEYS.filter(k => r.dims[k]).map(k => {
    const max = Math.max(...DIM_KEYS.map(x => r.dims[x] || 0), 1);
    const pct = Math.round((r.dims[k] / max) * 100);
    return `<div class="dim"><s>${k}</s><u><i style="width:${pct}%"></i></u><em>${r.dims[k]}</em></div>`;
  }).join('');

  return `
  <section class="card">
    <div class="card-h"><span class="ci">断</span><h2>总断</h2>
      <span class="hint">共 ${r.matched} 象</span></div>

    <div class="verdict">
      <div class="vring" style="--vp:${Math.round(r.score)};--vc:${col}">
        <div class="vnum"><b style="color:${col}">${Math.round(r.score)}</b><i>吉凶分</i></div>
      </div>
      <div class="vmeta">
        <span class="vgrade" style="color:${col}">${meta.label}</span>
        <p class="vsub">梦境倾向参考值 · 满分 100，50 为吉凶相半</p>
        <div class="vbar"><i style="width:${Math.round(r.score)}%"></i></div>
      </div>
    </div>

    <div class="summary">${r.summary.map((p, i) => `<p class="${i === 1 ? 'lead' : ''}">${esc(p)}</p>`).join('')}</div>

    ${dims ? `<div class="card-h" style="margin:16px 0 12px;border-bottom:0;padding-bottom:0">
      <h2 style="font-size:14px">预兆维度分布</h2></div><div class="dims">${dimHtml}</div>` : ''}

    <div class="btn-row" style="margin-top:16px">
      <button class="btn-sub" id="copy">复制解梦结果</button>
      <button class="btn-sub" id="again">重新解一梦</button>
    </div>
  </section>`;
}

/* ---------- 渲染：逐象 ---------- */
function symCard(it, detailed) {
  const e = it.entry;
  const gl = G_LABEL[String(e.g)] || G_LABEL['0'];
  const cat = CAT_LABEL[e.c] || e.c;
  const w = esc(it.win).split(esc(it.key)).join(`<em>${esc(it.key)}</em>`);
  const tg = (e.tg || []).map(t => `<s>${esc(t)}</s>`).join('');
  const other = (e.sc || []).filter(s => !it.scene || s.s !== it.scene.s);

  return `
  <article class="sym gc${String(e.g).replace('-', 'm')}">
    <div class="sym-h">
      <b>${esc(e.k)}</b>
      <span class="cat">${esc(cat)}</span>
      <span class="gk ${gl[1]}">${gl[0]}</span>
    </div>
    <p class="sym-w">梦中说：…${w}…</p>
    <div class="sym-sec">
      <h4>传统断语</h4>
      <p>${esc(e.ct)}</p>
    </div>
    <div class="sym-sec ps">
      <h4>心理象征</h4>
      <p>${esc(e.ps)}</p>
    </div>
    ${it.scene ? `<div class="sym-sec">
      <h4>对应情境</h4>
      <div class="sym-sc"><b>${esc(it.scene.s)}</b><span>${esc(it.scene.v)}</span></div>
    </div>` : ''}
    ${detailed && other.length ? `<details class="sym-more">
      <summary>此象其他情境（${other.length}）</summary>
      ${other.map(s => `<div class="more-i"><b>${esc(s.s)}</b><span>${esc(s.v)}</span></div>`).join('')}
    </details>` : ''}
    ${tg ? `<div class="sym-tg">${tg}</div>` : ''}
  </article>`;
}

/* ---------- 渲染：无匹配 ---------- */
function renderEmpty(r) {
  const text = (r && r.text) || $('dream').value || '';
  const sug = suggestEntries(text, ENTRIES, 6);
  // 兜底词必须真实存在于当前语料——语料变动时不会给出点了没反应的死建议
  const seen = new Set(sug.map(e => e.k));
  const present = k => ENTRIES.some(e => e.k === k);
  let extra = ['蛇', '掉牙', '水', '被追', '考试', '死人', '飞', '火', '钱', '迷路']
    .filter(k => present(k) && !seen.has(k)).slice(0, 4);
  // 兜底词全不在当前语料时，从梦书里取几个常见符号顶上，保证永远有可点的入口
  if (!extra.length) {
    const pool = ENTRIES.filter(e => e.k.length <= 2 && e.nm && e.nm.length >= 2 && !seen.has(e.k));
    for (let i = 0; i < 4 && pool.length; i++) {
      extra.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].k);
    }
  }

  return `
  <section class="card">
    <div class="card-h"><span class="ci">疑</span><h2>梦书未录此象</h2></div>
    <div class="res-empty">
      <div class="big">🌫️</div>
      <p>没能从这个描述里认出可对照的梦象。</p>
    </div>
    ${sug.length ? `
    <div class="sug-block">
      <h4>你是不是想找</h4>
      <div class="sug-list">${sug.map(e =>
        `<button class="sug-i" data-fill="${esc(e.k)}"><b>${esc(e.k)}</b><i>${esc(CAT_LABEL[e.c] || '')}</i></button>`).join('')}</div>
    </div>` : ''}
    <div class="sug-block">
      <h4>把梦拆开写更好认</h4>
      <p class="sug-tip">试试「谁 + 做了什么 + 结果如何」，并且多用具体的名词。例如
        <b>「梦见一条黑蛇追着我，我躲进老房子」</b>，比「做了个怪梦」命中率高得多。</p>
      <div class="sug-list small">${extra.map(k =>
        `<button class="sug-i" data-fill="${esc(k)}"><b>${esc(k)}</b></button>`).join('')}</div>
    </div>
    <div class="sug-block ai-block">
      <h4>让 AI 再读一遍</h4>
      <p class="sug-tip">梦书没收录这种说法，可以交给 AI 就这段梦境给一段解读。
        <b>这会把你写的梦境发送到服务器</b>（本页其余部分全程只在本机计算）。</p>
      <div class="ai-consent" id="ai-consent">
        <label class="ai-ck"><input type="checkbox" id="ai-ck"><span>我明白梦境将发送到服务器</span></label>
        <button class="ai-go" id="ai-go" disabled>请 AI 解读</button>
      </div>
      <div id="ai-out"></div>
    </div>
    <p class="tip" style="margin-top:14px">当前梦书收录 ${ENTRIES.length} 个符号、${INDEX.length} 条可匹配词。
      也可以点下方「翻梦书」按类别浏览全部梦象。</p>
  </section>`;
}

/* ---------- AI 解读（仅在用户显式同意后调用；默认全本地） ---------- */
function bindAI(text, sug) {
  const ck = $('ai-ck'), go = $('ai-go'), out = $('ai-out');
  if (!ck || !go || !out) return;

  ck.onchange = () => {
    go.disabled = !ck.checked;
    go.classList.toggle('ready', ck.checked);
  };

  go.onclick = async () => {
    if (!ck.checked) return;
    go.disabled = true;
    const old = go.textContent;
    go.textContent = '解读中…';
    out.innerHTML = '<div class="ai-load"><i></i><span>正在生成解读，约需 3–10 秒</span></div>';
    try {
      const r = await fetch('/api/ai-dream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent: '1',
          dream: text.slice(0, 400),
          symbols: sug.map(e => e.k).slice(0, 5),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (j && j.ok && j.text) {
        out.innerHTML = renderAiText(j.text, j);
      } else {
        out.innerHTML = `<div class="ai-err">没能拿到解读（${esc(aiErrMsg(j && j.error))}）。
          梦书以外的内容仍可参考上面的建议换个说法再试。</div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="ai-err">网络不通，未能取得解读。你可以稍后再试。</div>`;
    } finally {
      go.textContent = old;
      go.disabled = !ck.checked;
    }
  };
}

function aiErrMsg(code) {
  return ({
    rate_limited: '今天用得有点多，明天再来',
    ai_unavailable: '本服务未开启',
    consent_required: '需要先勾选同意',
    too_short: '描述太短',
    ai_failed: '服务暂时不可用',
    empty_response: '没有返回内容',
  })[code] || '未知原因';
}

/* 把四段式输出渲染成卡片。
   模型有时会回读段名（「梦象一个复杂的事情」），这里按行切分并剥离行首段名。 */
function renderAiText(text, meta) {
  const SRC = String(text);
  let parts = SRC.split(/\n(?=\s*\*{0,2}(?:梦象|心理|民俗|建议)\*{0,2}\s*[：:]?)/)
    .map(s => s.trim()).filter(Boolean);

  // 兜底②：模型把四段挤成一行且段名带 **（如「**梦象**：…  **心理**：…」）——
  // 字面 **段名** 在正文里几乎不会出现，切分无歧义
  if (parts.length < 2) {
    parts = SRC.split(/(?=\*\*\s*(?:梦象|心理|民俗|建议)\*\*)/).map(s => s.trim()).filter(Boolean);
  }

  // 兜底③：段名裸写且处于句首/句号后（如「…。心理从心理层面看…」）
  if (parts.length < 2) {
    parts = SRC
      .replace(/([。！？])\s*(?=(?:梦象|心理|民俗|建议))/g, '$1\n\n')
      .split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  }

  let html = '';
  for (const p of parts) {
    const m = p.match(/^\s*\*{0,2}(梦象|心理|民俗|建议)\*{0,2}\s*[：:]?\s*([\s\S]*)$/);
    if (m) {
      const body = m[2].trim();
      if (!body) continue;
      html += `<div class="ai-sec"><b>${esc(m[1])}</b><p>${esc(body)}</p></div>`;
    } else {
      html += `<div class="ai-sec"><p>${esc(p)}</p></div>`;
    }
  }
  if (!html) html = `<div class="ai-sec"><p>${esc(text)}</p></div>`;
  const note = `由 AI 生成 · ${meta.model ? esc(String(meta.model).split('/').pop()) : ''}${meta.ms ? ' · ' + meta.ms + 'ms' : ''}`;
  return `<div class="ai-res">${html}
    <p class="ai-note">${note}${meta.softened ? ' · 已按红线改写措辞' : ''}</p>
    <p class="ai-note">AI 生成内容同样只作文化娱乐参考，不构成任何建议。</p>
  </div>`;
}

/* ---------- 主流程 ---------- */
async function solve(text) {
  if (busy) return;
  if (!ENTRIES.length) {
    showErr('梦书尚未载入完成，请稍候一瞬再试。');
    return;
  }
  text = String(text || '').trim();
  if (!text) { showErr('先写下你梦见了什么。'); $('dream').focus(); return; }
  if (text.length < 2) { showErr('再多写一点吧，两个字以上的描述才认得出来。'); return; }

  busy = true;
  $('err').style.display = 'none';
  $('go').disabled = true;
  $('result').innerHTML = '';
  $('card-history').hidden = false;

  const cast = $('cast');
  cast.hidden = false;
  const steps = ['翻阅梦书…', '逐象检索…', '比对情境…', '合参定级…'];
  let si = 0;
  $('castStep').textContent = steps[0];
  const timer = setInterval(() => { si = (si + 1) % steps.length; $('castStep').textContent = steps[si]; }, 300);

  const r = interpret(text, ENTRIES, INDEX);

  const wait = 900 + Math.min(600, text.length * 6);
  await new Promise(res => setTimeout(res, wait));

  clearInterval(timer);
  cast.hidden = true;
  $('go').disabled = false;
  busy = false;

  current = r;

  if (!r || !r.matched) {
    const emptyText = ($('dream').value || '').trim();
    $('result').innerHTML = renderEmpty(r || { matched: 0 });
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    bindResult();
    bindAI(emptyText, suggestEntries(emptyText, ENTRIES, 5));
    return;
  }

  const top = r.items.slice(0, 5);
  const rest = r.items.slice(5);

  let html = renderVerdict(r);
  html += `<section class="card">
    <div class="card-h"><span class="ci">象</span><h2>逐象详解</h2>
      <span class="hint">按梦象权重排序</span></div>
    ${top.map(it => symCard(it, true)).join('')}
    ${rest.length ? `<details class="sym-more" style="margin-top:4px">
      <summary>其余 ${rest.length} 个次要梦象</summary>
      ${rest.map(it => symCard(it, false)).join('')}
    </details>` : ''}
  </section>`;

  $('result').innerHTML = html;
  pushHist(text, r.score, r.grade);
  renderHist();
  bumpStat();

  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  bindResult();
}

function bindResult() {
  const c = $('copy');
  if (c) c.onclick = () => copyResult();
  const a = $('again');
  if (a) a.onclick = () => {
    $('dream').value = '';
    onInput();
    $('dream').focus();
    $('card-input').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('result').querySelectorAll('[data-fill]').forEach(b => {
    b.onclick = () => {
      const ta = $('dream');
      // 未命中场景下建议是"换个说法再试"，应替换而不是追加——
      // 追加会把本来就匹配不上的原文一起带上，点了照样无解
      const keep = current && current.matched;
      ta.value = keep ? (ta.value.trim() + '，梦见了' + b.dataset.fill) : ('梦见' + b.dataset.fill);
      onInput();
      solve(ta.value);
    };
  });
}

function copyResult() {
  const r = current;
  if (!r || !r.matched) return;
  const meta = GRADE_META[r.grade] || GRADE_META.none;
  const lines = [`【周公解梦】${r.text}`, `综合：${meta.label}（${Math.round(r.score)} 分）`, ''];
  for (const p of r.summary) lines.push(p);
  lines.push('');
  for (const it of r.items) {
    lines.push(`· ${it.entry.k}（${G_LABEL[String(it.entry.g)][0]}）：${it.entry.ct}`);
  }
  lines.push('', '——来自「周公解梦」');
  const text = lines.join('\n');
  const done = () => flash('已复制到剪贴板');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch (e) { flash('复制失败，请长按选择文本'); }
}

function flash(msg) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 1800);
}

function showErr(msg) {
  const e = $('err');
  e.textContent = msg;
  e.style.display = 'block';
}

function bumpStat() {
  try {
    const o = JSON.parse(localStorage.getItem(SKEY) || '{"n":0}');
    o.n = (o.n || 0) + 1;
    localStorage.setItem(SKEY, JSON.stringify(o));
  } catch (e) { /* ignore */ }
}

/* ---------- 本机记录渲染 ---------- */
function renderHist() {
  const list = readHist();
  const card = $('card-history');
  if (!list.length) { card.hidden = true; return; }
  card.hidden = false;
  $('hist-list').innerHTML = list.map(h => {
    const col = RING_COLOR[h.g] || RING_COLOR.none;
    const meta = GRADE_META[h.g] || GRADE_META.none;
    const d = new Date(h.ts);
    const pad = n => String(n).padStart(2, '0');
    const when = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `<div class="hist-i" data-t="${esc(h.t)}">
      <div class="ht">${esc(h.t)}</div>
      <div class="hm"><em style="color:${col}">${meta.label}</em><span>${h.s} 分</span><span>${when}</span></div>
    </div>`;
  }).join('');
  $('hist-list').querySelectorAll('.hist-i').forEach(el => {
    el.onclick = () => {
      $('dream').value = el.dataset.t;
      onInput();
      solve(el.dataset.t);
    };
  });
}

/* ---------- 翻梦书 ---------- */
let browseCat = 'all';
let browseQ = '';

function renderBrowse() {
  $('browseCount').textContent = `共 ${ENTRIES.length} 象`;
  const cats = ['all', ...Object.keys(CAT_LABEL).filter(c => ENTRIES.some(e => e.c === c))];
  $('tabs').innerHTML = cats.map(c => {
    const label = c === 'all' ? '全部' : CAT_LABEL[c];
    const n = c === 'all' ? ENTRIES.length : ENTRIES.filter(e => e.c === c).length;
    return `<button class="tab ${c === browseCat ? 'on' : ''}" data-c="${c}">${label} ${n}</button>`;
  }).join('');

  let list;
  if (browseQ) {
    list = searchEntries(browseQ, ENTRIES, 200);
  } else {
    list = browseCat === 'all' ? ENTRIES.slice(0, 200) : ENTRIES.filter(e => e.c === browseCat);
  }
  if (!list.length) {
    $('blist').innerHTML = '<div class="bempty">没有找到这个梦象，换个说法试试</div>';
    return;
  }
  $('blist').innerHTML = list.slice(0, 300).map(e => {
    const gl = (e.g >= 1) ? 'g1' : (e.g <= -1) ? 'gm1' : '';
    return `<div class="bi ${gl}" data-k="${esc(e.k)}" data-c="${esc(e.c)}">
      <b>${esc(e.k)}</b><i>${esc(CAT_LABEL[e.c] || '')}</i></div>`;
  }).join('');

  $('blist').querySelectorAll('.bi').forEach(el => {
    el.onclick = () => showDetail(el.dataset.k, el.dataset.c);
  });
  $('tabs').querySelectorAll('.tab').forEach(el => {
    el.onclick = () => { browseCat = el.dataset.c; browseQ = ''; $('bq').value = ''; renderBrowse(); };
  });
}

function showDetail(k, c) {
  const e = ENTRIES.find(x => x.k === k && (!c || x.c === c)) || ENTRIES.find(x => x.k === k);
  if (!e) return;
  const gl = G_LABEL[String(e.g)] || G_LABEL['0'];
  $('d-title').textContent = `梦见${e.k}`;
  $('d-body').innerHTML = `
    <div class="d-sec">
      <h3>吉凶 · ${gl[0]}</h3>
      <p class="nm">类别：${esc(CAT_LABEL[e.c] || e.c)}${e.nm.length ? ' ｜ 别称：' + esc(e.nm.join('、')) : ''}</p>
      <h3>传统断语</h3>
      <p>${esc(e.ct)}</p>
      <h3>心理象征</h3>
      <p>${esc(e.ps)}</p>
      <h3>情境分述</h3>
      ${(e.sc || []).map(s => `<div class="d-sc"><b>${esc(s.s)}</b><span>${esc(s.v)}</span></div>`).join('') || '<p>—</p>'}
      ${e.tg && e.tg.length ? `<h3>预兆维度</h3><div class="sym-tg" style="border:0;padding:0">${e.tg.map(t => `<s>${esc(t)}</s>`).join('')}</div>` : ''}
    </div>`;
  const card = $('card-detail');
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 启动 ---------- */
function boot() {
  window.__bootOK = true;
  stars();
  initQuick();
  renderHist();

  const ta = $('dream');
  ta.addEventListener('input', onInput);
  $('go').onclick = () => solve(ta.value);
  $('clear').onclick = () => {
    ta.value = '';
    onInput();
    $('result').innerHTML = '';
    ta.focus();
  };
  $('random').onclick = () => {
    ta.value = RANDOM_DREAMS[Math.floor(Math.random() * RANDOM_DREAMS.length)];
    onInput();
    solve(ta.value);
  };
  $('browse').onclick = () => {
    const card = $('card-browse');
    card.hidden = !card.hidden;
    if (!card.hidden) {
      renderBrowse();
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  $('bq').addEventListener('input', () => {
    browseQ = $('bq').value.trim();
    browseCat = 'all';
    renderBrowse();
  });
  $('d-close').onclick = () => { $('card-detail').hidden = true; };
  $('hist-clear').onclick = () => { clearHist(); renderHist(); };

  ta.placeholder = '梦书载入中…';

  loadAll((done, total, name) => {
    if (done >= total) return;
    ta.placeholder = `梦书载入中… ${done}/${total}`;
  }).then(list => {
    ENTRIES = list;
    INDEX = buildIndex(ENTRIES);
    ta.placeholder = '把梦见的写下来，越具体越准。例如：梦见一条大白蛇追着我跑，我躲进了一个很旧的房子，屋里全是水。';
    $('err').style.display = 'none';
    ta.focus();
    onInput();
    renderBrowse();
    deepLink();
  }).catch(e => {
    showErr('梦书载入失败：' + e.message + '。请刷新重试。');
  });
}

/* 支持 ?q=梦见的内容 直接出结果（方便分享） */
function deepLink() {
  try {
    const q = new URLSearchParams(location.search).get('q');
    if (!q) return;
    $('dream').value = q.slice(0, 300);
    onInput();
    solve($('dream').value);
  } catch (e) { /* ignore */ }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* ---------- 自动更新：长开标签页回前台时自检版本，发现新版弹 toast 一键刷新 ----------
   版本戳取自自身 <script src="app.js?v=…">，与 build.mjs 写入的 /version.json 比对。
   HTML 本身 no-cache 每次进页都是新的，真正陈旧的只有长开的标签页——这里补上这一环。 */
(function () {
  const sm = document.querySelector('script[src*="app.js?v="]');
  const V = sm ? (sm.src.match(/v=([a-z0-9]+)/) || [])[1] : '';
  if (!V) return;
  let last = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 5 * 60 * 1000) return;
    last = Date.now();
    fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j || !j.v || j.v === V) return;
        if (document.querySelector('.toast.upd')) return;
        const t = document.createElement('div');
        t.className = 'toast on upd';
        t.textContent = '梦书已更新，点此刷新';
        t.style.cursor = 'pointer';
        t.onclick = () => location.reload();
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 15000);
      })
      .catch(() => {});
  });
})();
