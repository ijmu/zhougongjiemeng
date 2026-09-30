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

/** 从 localStorage 读一次性缓存，避免每次重访都拉 12 个文件 */
function readCache() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || !Array.isArray(o.e) || o.e.length < 200) return null;
    return o.e;
  } catch (e) { return null; }
}

function writeCache(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, e: list }));
  } catch (e) { /* 配额满 / 隐私模式：忽略，不影响功能 */ }
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
  let ok = 0;
  _loading = Promise.all(FILES.map(name =>
    fetch('data/' + name + '.json', { cache: 'force-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        done++;
        if (Array.isArray(j)) { ok++; if (onProgress) onProgress(done, FILES.length, name); }
        else if (onProgress) onProgress(done, FILES.length, name);
        return Array.isArray(j) ? j : [];
      })
      .catch(() => { done++; if (onProgress) onProgress(done, FILES.length, name); return []; })
  )).then(parts => {
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
    if (ok >= 6 && clean.length >= 200) { _all = clean; writeCache(clean); }
    return clean;
  });

  return _loading;
}

export function getLoaded() { return _all; }
export function fileNames() { return FILES.slice(); }
