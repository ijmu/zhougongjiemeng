/* data.js · 语料加载与缓存（纯浏览器，无后端） */

const FILES = [
  'animal', 'person', 'body', 'nature', 'plant', 'object',
  'place', 'action', 'event', 'emotion', 'spirit', 'misc',
];

const KEY = 'zm_cache_v1';

let _all = null;
let _loading = null;

function normalize(list) {
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || !e.k) continue;
    out.push({
      k: String(e.k),
      c: e.c || 'misc',
      g: Number(e.g) || 0,
      nm: Array.isArray(e.nm) ? e.nm.filter(x => typeof x === 'string' && x) : [],
      ct: e.ct || '',
      ps: e.ps || '',
      sc: Array.isArray(e.sc) ? e.sc.filter(x => x && x.s && x.v) : [],
      tg: Array.isArray(e.tg) ? e.tg.filter(x => typeof x === 'string' && x) : [],
    });
  }
  return out;
}

/** 从 localStorage 读一次性缓存，避免每次重访都拉 12 个文件。
    半载缓存一律作废：n !== FILES.length 说明上次是坏网络下写进去的，
    一旦命中用户就永远用半本梦书（网络抖一次 = 永久降级）。 */
function readCache() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || !Array.isArray(o.e) || o.e.length < 200) return null;
    if (o.n !== FILES.length) return null;
    return o.e;
  } catch (e) { return null; }
}

function writeCache(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, n: FILES.length, e: list }));
  } catch (e) { /* 配额满 / 隐私模式：忽略，不影响功能 */ }
}

async function fetchOne(name, tick) {
  try {
    const r = await fetch('data/' + name + '.json', { cache: 'force-cache' });
    const j = r.ok ? await r.json() : null;
    const list = Array.isArray(j) ? j : [];
    tick(name);
    return list;
  } catch (e) { tick(name); return []; }
}

/**
 * 加载全部语料。onProgress(loaded, total, name)
 * 逐文件容错：任一文件 404/解析失败只跳过，不阻断整体。
 */
export function loadAll(onProgress) {
  if (_all) return Promise.resolve(_all);
  if (_loading) return _loading;

  const cached = readCache();
  if (cached) { _all = cached; onProgress && onProgress(FILES.length, FILES.length, 'cache'); return Promise.resolve(_all); }

  let done = 0;
  const tick = name => { done++; if (onProgress) onProgress(done, FILES.length, name); };

  _loading = (async () => {
    let parts = await Promise.all(FILES.map(n => fetchOne(n, tick)));

    // 网络抖动自愈：对拉空了的文件静默重试一次（不重复推进度条）
    let bad = FILES.filter((n, i) => !parts[i].length);
    if (bad.length) {
      await new Promise(r => setTimeout(r, 500));
      const again = await Promise.all(bad.map(n => fetchOne(n, () => {})));
      for (let i = 0; i < bad.length; i++) parts[FILES.indexOf(bad[i])] = again[i];
      bad = FILES.filter((n, i) => !parts[i].length);
      if (onProgress) onProgress(FILES.length, FILES.length, 'retry:' + (bad.length ? 'partial' : 'ok'));
    }

    const clean = [];
    const seen = new Set();
    for (const p of parts) {
      for (const e of normalize(p)) {
        const id = e.k + '|' + e.c;
        if (seen.has(id)) continue;
        seen.add(id);
        clean.push(e);
      }
    }
    _loading = null;
    const okCount = parts.filter(p => p.length).length;
    // 会话内 ≥6 个文件即可用（坏一点也比全空强）；
    // 但只有 **全量** 才允许写缓存——半载绝不过夜
    if (okCount >= 6 && clean.length >= 200) _all = clean;
    if (okCount === FILES.length && clean.length >= 200) writeCache(clean);
    return clean;
  })();

  return _loading;
}

export function getLoaded() { return _all; }
export function fileNames() { return FILES.slice(); }
