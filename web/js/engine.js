/* engine.js · 解梦内核
 * 纯函数、零 DOM：索引构建 / 文本匹配 / 情境判定 / 断语合成 / 吉凶定级
 * 数据契约见 SCHEMA.md
 */

export const DIM_KEYS = ['财运', '事业', '感情', '健康', '人际', '心绪', '出行', '学业'];

export const CAT_LABEL = {
  animal: '动物', person: '人物', body: '身体', nature: '天象自然', plant: '植物',
  object: '物品器物', place: '场所建筑', action: '行为动作', event: '人生事件',
  emotion: '情绪心绪', spirit: '鬼神超自然', misc: '其他',
};

/* 吉凶倾向 g(-2..2) → 0..100 */
const G_POINT = { '2': 88, '1': 74, '0': 55, '-1': 36, '-2': 16 };
export const G_LABEL = {
  '2': ['大吉', 'g2'], '1': ['吉', 'g1'], '0': ['平', 'g0'],
  '-1': ['凶', 'gm1'], '-2': ['大凶', 'gm2'],
};

/* 断语正负词，用于给自由文本的情境断语估一个方向 */
const POS_WORDS = ['吉', '顺', '成', '进', '财', '喜', '得', '贵', '升', '旺', '安', '康', '和', '合', '解', '转机', '增长', '收获', '佳', '宜'];
const NEG_WORDS = ['凶', '阻', '失', '忧', '损', '危', '退', '衰', '病', '离', '散', '困', '滞', '警', '谨', '慎', '忌', '烦', '压', '疲', '焦', '争', '伤'];

export function textSentiment(s) {
  let p = 0, n = 0;
  for (const w of POS_WORDS) if (s.includes(w)) p++;
  for (const w of NEG_WORDS) if (s.includes(w)) n++;
  const d = p - n;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/* ---------- 梦者情绪基调（区别于上面的断语倾向） ----------
   textSentiment 算的是「断语的吉凶倾向」，这里算的是「梦者描述梦境时用的情绪词」。
   现代梦研究的共识：梦的情绪往往比意象内容更可靠。词表是梦者的口语，粗略基调，仅供自我觉察。 */
const MOOD_LEX = {
  fear: ['怕', '吓', '恐', '惊', '追', '逃', '躲', '坠', '掉下', '困住', '喊不出', '叫不', '僵', '慌', '急醒', '鬼', '怪物', '袭击', '危险', '喘', '窒息', '噩梦', '醒不来', '追杀', '冷汗', '心悸'],
  sad: ['哭', '泪', '悲', '难过', '丢', '失去', '找不', '离别', '离开', '想念', '思念', '孤独', '逝', '告别', '空落', '遗憾'],
  anger: ['吵', '骂', '打架', '吵架', '争执', '恨', '怒', '气死', '冲突', '摔', '憋'],
  calm: ['笑', '开心', '高兴', '美', '晴', '飞', '甜', '舒服', '轻松', '温暖', '自由', '香', '稳', '亮堂', '治愈'],
};
const MOOD_META = {
  fear: { label: '紧张 · 惊惧', note: '紧张类情绪占主导——现代梦研究更倾向把它看作近期压力或未消化事件的延续，而不是预兆。' },
  sad: { label: '悲伤 · 失落', note: '失落感主导——常与具体的失去、告别或怀念有关，允许自己为此停一停。' },
  anger: { label: '愤怒 · 冲突', note: '冲突感主导——可能有一些没说出口的不满，找个安全的出口比压着更有效。' },
  calm: { label: '平静 · 愉悦', note: '平静愉悦主导——多是状态的映照，没有需要对抗的东西，安心睡。' },
};

export function moodTone(s) {
  const t = String(s || '');
  if (!t) return null;
  let best = null, bestN = 0, bestWs = null;
  for (const k in MOOD_LEX) {
    const ws = MOOD_LEX[k].filter(w => t.includes(w));
    if (ws.length && ws.length > bestN) { best = k; bestN = ws.length; bestWs = ws; }
  }
  if (!best) return null;
  const m = MOOD_META[best];
  return { tone: best, label: m.label, note: m.note, n: bestN,
    words: bestWs.slice(0, 4), lvl: bestN >= 5 ? 3 : bestN >= 3 ? 2 : 1 };
}

/* ---------- 索引 ---------- */

/**
 * 把条目数组编成可搜索索引。
 * 每个条目展开成若干 key（主键 k + 别名 nm），按长度降序匹配时长的优先。
 */
export function buildIndex(entries) {
  const idx = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    idx.push({ key: e.k, len: e.k.length, i, main: true });
    const nm = e.nm || [];
    for (const a of nm) {
      if (!a || a === e.k) continue;
      idx.push({ key: a, len: a.length, i, main: false });
    }
  }
  // 长的优先；同长度时主键优先
  idx.sort((a, b) => b.len - a.len || (a.main === b.main ? 0 : a.main ? -1 : 1));
  return idx;
}

/* ---------- 文本匹配 ---------- */

/* 双义词：既是梦象、又是高频连词/抽象词。
   判别法：作连词用时几乎总出现在句首或标点之后（"，结果牙齿掉了"）；
   作梦象用时在短语中间（"梦见开花结果"）。故：前一个字符是标点/空白/句首 → 视为连词，跳过。 */
const AMBIG = new Set(['结果', '意思', '关系', '问题', '东西', '时间', '地方', '事情', '情况', '办法', '样子', '声音']);
const AMBIG_PRE = new Set('，。、；：！？,.;:!? \t\n　');

function isConnectiveUse(s, start, key) {
  if (!AMBIG.has(key)) return false;
  if (start === 0) return true;
  return AMBIG_PRE.has(s[start - 1]);
}

/**
 * 在 text 中找出所有命中符号，长键优先、区间不重叠。
 * 返回 [{ i, key, main, start, end, len }]
 */
export function matchText(text, index) {
  const s = String(text || '');
  if (!s) return [];
  const taken = new Array(s.length).fill(false);
  const hits = [];
  for (const it of index) {
    let from = 0;
    for (;;) {
      const p = s.indexOf(it.key, from);
      if (p < 0) break;
      const e = p + it.len;
      // 双义词作连词用时不算梦象
      if (isConnectiveUse(s, p, it.key)) { from = p + 1; continue; }
      let free = true;
      for (let q = p; q < e; q++) if (taken[q]) { free = false; break; }
      if (free) {
        for (let q = p; q < e; q++) taken[q] = true;
        // 同一符号只记第一次命中，避免"蛇蛇蛇"刷屏
        if (!hits.some(h => h.i === it.i)) {
          hits.push({ i: it.i, key: it.key, main: it.main, start: p, end: e, len: it.len });
        }
        break;
      }
      from = p + 1;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

/* ---------- 情境判定 ---------- */

/** 取命中位置附近的一小段文本作上下文窗口 */
export function winAround(text, start, end, span) {
  const w = span == null ? 12 : span;
  const a = Math.max(0, start - w);
  const b = Math.min(text.length, end + w);
  return text.slice(a, b);
}

function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  if (!out.length) out.push(s);
  return out;
}

/**
 * 在 entry 的 sc 列表里挑与上下文最贴的一条。
 * 打分 = 情境短语与窗口的二元组重合度 + 单字重合率；并给"情境短语去掉主键名词后的剩余动词部分"加权。
 * 无合适者返回 null。
 */
export function pickScene(entry, win, key) {
  const sc = entry && entry.sc;
  if (!sc || !sc.length) return null;
  const stem = key ? win.split(key).join('') : win;
  const bw = new Set(bigrams(stem));
  const bg = new Set(bigrams(win));
  let best = null, bestScore = 0;
  for (const it of sc) {
    const t = it.s || '';
    if (!t) continue;
    const parts = bigrams(t);
    let hit = 0;
    for (const g of parts) if (bg.has(g)) hit += 1;
    let hitStem = 0;
    for (const g of parts) if (bw.has(g)) hitStem += 1.6;
    // 单字覆盖
    let ch = 0;
    const seen = new Set();
    for (const c of t) { if (seen.has(c)) continue; seen.add(c); if (win.includes(c)) ch++; }
    const score = (hit + hitStem) / parts.length + ch / seen.size * 0.8;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return bestScore >= 0.55 ? best : null;
}

/* ---------- 单条评分 ---------- */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function entryPoint(entry) {
  return G_POINT[String(entry.g)] != null ? G_POINT[String(entry.g)] : 55;
}

/**
 * 命中权重：主键 > 别名；短语越长越具体，权重越高；越靠前出现的（首句通常是主梦象）权重略高。
 */
function hitWeight(h, textLen) {
  let w = h.main ? 1.25 : 1.0;
  w *= 1 + Math.min(h.len - 1, 3) * 0.22;          // 长词更具体
  const rel = textLen > 0 ? h.start / textLen : 0;
  w *= 1.12 - rel * 0.24;                           // 首句权重 1.12 → 末句 0.88
  return w;
}

/* ---------- 断语合成 ---------- */

const SUMMARY_OPEN = {
  '2': '此梦气象盛大，诸象多应吉兆。',
  '1': '此梦大势向好，吉象偏多。',
  '0': '此梦吉凶交参，宜分象细看。',
  '-1': '此梦警象居多，宜留一分警觉。',
  '-2': '此梦重象压心，宜静观其变。',
};

const ADVICE = {
  '2': '梦象顺遂，是心理能量充沛的显现，乘势把已在推进的事再推一步即可，不必刻意求取。',
  '1': '整体偏吉，顺其自然即可，重点留意下方标注为「凶」的个别符号。',
  '0': '吉凶并见，说明你眼下正处在两股力量的拉扯中——先分清哪一线是你真正在意的，再作取舍。',
  '-1': '警象不只是坏消息，它是潜意识在提醒你某件事已被拖延太久，值得直接面对。',
  '-2': '重压意象多出现在身心透支期。先照顾睡眠与情绪，再谈事情本身，别在此时作重大决定。',
};

function topDim(dims) {
  let best = null, v = -1;
  for (const k of DIM_KEYS) if ((dims[k] || 0) > v) { v = dims[k] || 0; best = k; }
  return v > 0 ? best : null;
}

/**
 * 合成总览断语。参数：命中条目数组、总分、维度计数
 */
export function composeText(items, score, dims) {
  const gAvg = score >= 82 ? '2' : score >= 72 ? '1' : score >= 50 ? '0' : score >= 38 ? '-1' : '-2';
  const names = items.map(x => x.entry.k);
  const head = names.slice(0, 4).join('、') + (names.length > 4 ? ` 等 ${names.length} 象` : '');
  const good = items.filter(x => x.entry.g >= 1).map(x => x.entry.k);
  const bad = items.filter(x => x.entry.g <= -1).map(x => x.entry.k);

  const lines = [];
  lines.push(`此番梦中见 ${head}。`);
  lines.push(SUMMARY_OPEN[gAvg]);
  if (good.length && bad.length) {
    lines.push(`其中「${good.slice(0, 3).join('、')}」为吉象，主助力与新机；「${bad.slice(0, 3).join('、')}」为警象，主提醒与阻滞。吉凶并见，往往对应现实中「机会与顾虑同时到来」的处境。`);
  } else if (good.length) {
    lines.push(`全无凶象，诸梦皆吉。传统认为此类梦多主所谋得助、所求得应；心理层面则对应你近期的状态是舒展的、有余力的。`);
  } else if (bad.length) {
    lines.push(`未见明显吉象。传统以警象为主，主近期宜守不宜攻、宜静不宜动；心理层面多是压力与未竟之事的投射。`);
  }
  const d = topDim(dims);
  if (d) lines.push(`诸象所指，以「${d}」一线最为集中，可先从这里想。`);
  lines.push(ADVICE[gAvg]);
  return lines;
}

/* ---------- 主入口 ---------- */

/**
 * 解一次梦。
 * @param {string} text 用户输入的梦境描述
 * @param {Array}  entries 全量条目
 * @param {Array}  index buildIndex(entries) 的结果（可复用以省算力）
 * @returns {null|{items,score,grade,dims,summary,matched}}
 */
export function interpret(text, entries, index) {
  const s = String(text || '').trim();
  if (!s) return null;
  const idx = index || buildIndex(entries);
  const raw = matchText(s, idx);
  if (!raw.length) return { items: [], score: 0, grade: 'none', dims: {}, summary: [], matched: 0, text: s };

  const items = [];
  const seen = new Set();
  for (const h of raw) {
    if (seen.has(h.i)) continue;
    seen.add(h.i);
    const entry = entries[h.i];
    const win = winAround(s, h.start, h.end, 12);
    const scene = pickScene(entry, win, h.key);
    let point = entryPoint(entry);
    if (scene) point = clamp(point + textSentiment(scene.v) * 3.5, 5, 97);
    items.push({ entry, scene, win, key: h.key, w: hitWeight(h, s.length), point });
  }

  let wsum = 0, psum = 0;
  const dims = {};
  for (const it of items) {
    wsum += it.w;
    psum += it.w * it.point;
    for (const d of it.entry.tg || []) dims[d] = (dims[d] || 0) + 1;
  }
  const score = wsum > 0 ? psum / wsum : 0;
  // 信息量加成：梦象越丰富、命中越多，综合分向中性回归一点（避免单象定生死）
  const damp = 1 - Math.min(0.18, (items.length - 1) * 0.02);
  const finalScore = clamp(55 + (score - 55) * damp, 1, 99);

  const grade = finalScore >= 82 ? 'S' : finalScore >= 72 ? 'A' : finalScore >= 62 ? 'B'
    : finalScore >= 50 ? 'C' : finalScore >= 38 ? 'D' : 'E';

  return {
    items, score: finalScore, rawScore: score, grade, dims, matched: items.length,
    summary: composeText(items, finalScore, dims), text: s,
  };
}

export const GRADE_META = {
  S: { label: '大吉之梦', cls: 'gS' }, A: { label: '吉梦', cls: 'gA' },
  B: { label: '平吉之梦', cls: 'gB' }, C: { label: '吉凶相半', cls: 'gC' },
  D: { label: '小凶之梦', cls: 'gD' }, E: { label: '凶梦', cls: 'gE' },
  none: { label: '未识梦象', cls: 'gN' },
};

/* ---------- 模糊建议（未命中时用） ---------- */

/**
 * 从一段文本里切出候选字（二元组 + 单字），去语料里找最相近的梦象。
 * 用途：用户写了梦书没收录的说法时，给出「你是不是想找：
 * 只做确定性打分，不猜语义。
 */
/* 建议用的停用字：几乎所有梦境描述都含这些字，留着会让无关条目靠单字刷分
   （实测「托梦」「死亡」曾被建议到每一条输入下，就是被「梦」字带出来的） */
const SUG_STOP = new Set('梦见到来了的我你他她它是在有和与或就都很不没有一二三四五六七八九十之其了着过把被让给对从向于而且但只是还有些个什么怎么'.split(''));

export function suggestEntries(text, entries, limit) {
  const s = String(text || '');
  const lim = limit || 6;
  if (!s || !entries.length) return [];

  // 候选片段：优先二元组，再补单字（滤掉停用字）
  const grams = new Set();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    if (/^[\u4e00-\u9fa5]{2}$/.test(g) && !SUG_STOP.has(g[0]) && !SUG_STOP.has(g[1])) grams.add(g);
  }
  for (const c of s) if (/[\u4e00-\u9fa5]/.test(c) && !SUG_STOP.has(c)) grams.add(c);
  if (!grams.size) return [];

  const scored = [];
  for (const e of entries) {
    const names = [e.k, ...(e.nm || [])];
    let best = 0, strong = false;
    for (const n of names) {
      if (!n) continue;
      let sc = 0;
      let sub = false, bigrams = 0;
      // 完整包含关系权重最高
      if (s.includes(n)) { sc = n.length * 3; sub = true; }
      else {
        // 共享二元组数（停用字不算）
        for (let i = 0; i < n.length - 1; i++) {
          const g = n.slice(i, i + 2);
          if (grams.has(g) && !SUG_STOP.has(g[0]) && !SUG_STOP.has(g[1])) { sc += 2.2; bigrams++; }
        }
        for (const c of n) if (grams.has(c) && !SUG_STOP.has(c)) sc += 0.7;
        // 主键本身短，避免"水"这类单字刷屏
        if (n.length === 1 && sc > 0) sc *= 0.55;
      }
      if (sc > best) {
        best = sc;
        // 可信度：完整命中，或共享 ≥2 个二元组，或单个二元组已占名字大半（≤3 字）
        strong = sub || bigrams >= 2 || (bigrams === 1 && n.length <= 3);
      }
    }
    if (best < 2 || !strong) continue;
    // 归一化，避免长别名靠堆字数胜出
    const norm = best / (1 + Math.log2(1 + e.k.length));
    scored.push({ e, s: norm });
  }
  scored.sort((a, b) => b.s - a.s || (a.e.k < b.e.k ? -1 : 1));
  return scored.slice(0, lim).map(x => x.e);
}

/* ---------- 检索（用于热门/分类浏览、反查） ---------- */

export function searchEntries(q, entries, limit) {
  const s = String(q || '').trim().toLowerCase();
  const lim = limit || 40;
  const out = [];
  for (const e of entries) {
    const hay = (e.k + '|' + (e.nm || []).join('|')).toLowerCase();
    if (!s) { out.push({ e, r: 0 }); continue; }
    if (e.k === q) { out.push({ e, r: 3 }); continue; }
    if (e.k.includes(q)) { out.push({ e, r: 2 }); continue; }
    if (hay.includes(s)) out.push({ e, r: 1 });
  }
  out.sort((a, b) => b.r - a.r || a.e.k.length - b.e.k.length || (a.e.k < b.e.k ? -1 : 1));
  return out.slice(0, lim).map(x => x.e);
}
