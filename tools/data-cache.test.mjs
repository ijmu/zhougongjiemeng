#!/usr/bin/env node
/* data-cache.test.mjs · 语料缓存与版本失效的纯逻辑回归（免 jsdom）
   覆盖：hash 命中零请求 / hash 失配重取 / 离线退化信任缓存 /
        半载不落盘 / 旧格式缓存升级 / 全量写缓存带 hash */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/js/data.js', import.meta.url).pathname, 'utf8')
  .replace(/^export\s+/gm, '');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const ENTRY = i => ({ k: '象' + i, c: 'misc', g: 0, nm: [], ct: '', ps: '', sc: [], tg: [] });
const BIG = Array.from({ length: 250 }, (_, i) => ENTRY(i));

function harness({ manifest = 'HASH-A', failCats = [], catCount = 1 } = {}) {
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: k => { delete store[k]; },
  };
  const stat = { manifest: 0, cats: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('manifest.json')) {
      stat.manifest++;
      if (manifest === 'OFFLINE') throw new Error('offline');
      if (manifest === '404') return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => ({ v: 1, hash: manifest, total: 1045 }) };
    }
    const name = u.split('/').pop().split('?')[0].replace('.json', '');
    stat.cats++;
    if (failCats.includes(name)) throw new Error('net');
    return { ok: true, status: 200, json: async () => Array.from({ length: catCount }, (_, i) => ({ k: name + i, c: 'misc', g: 0, nm: [], ct: '', ps: '', sc: [], tg: [] })) };
  };
  const inst = new Function(src + '\nreturn { loadAll };')();
  return { inst, stat, store, KEY: 'zm_cache_v1' };
}

const cacheOf = (h, hash) => JSON.stringify({ v: 1, n: 12, hash, e: BIG });

// ① hash 匹配 → 只用缓存，语料零请求
{
  const h = harness({ manifest: 'HASH-A' });
  h.store[h.KEY] = cacheOf(h, 'HASH-A');
  const list = await h.inst.loadAll();
  ok(list.length === 250 && h.stat.cats === 0 && h.stat.manifest === 1,
    `hash 命中 → 零语料请求（manifest ${h.stat.manifest} 次，cats ${h.stat.cats} 次）`);
}

// ② hash 失配 → 全量重取 + 缓存换新 hash
{
  const h = harness({ manifest: 'HASH-B', catCount: 25 });
  h.store[h.KEY] = cacheOf(h, 'HASH-A');
  const list = await h.inst.loadAll();
  const rec = JSON.parse(h.store[h.KEY]);
  ok(list.length > 0 && h.stat.cats === 12 && rec.hash === 'HASH-B',
    `hash 失配 → 重取 12 文件并写入新指纹（实际 cats=${h.stat.cats}, 新hash=${rec.hash}）`);
}

// ③ manifest 离线 + 有效缓存 → 信任缓存（离线可用）
{
  const h = harness({ manifest: 'OFFLINE' });
  h.store[h.KEY] = cacheOf(h, 'HASH-OLD');
  const list = await h.inst.loadAll();
  ok(list.length === 250 && h.stat.cats === 0, 'manifest 不可达 → 离线退化用缓存，不阻断启动');
}

// ④ 半载（6/12 成功）→ 会话可用但不落盘
{
  const h = harness({ manifest: 'HASH-A', catCount: 25,
    failCats: ['animal', 'person', 'body', 'nature', 'plant', 'object'] });
  const list = await h.inst.loadAll();
  ok(list.length > 0 && !(h.KEY in h.store), `半载 → 会话内可用（${list.length} 条）但缓存不落盘`);
}

// ⑤ 旧格式缓存（无 hash 字段）+ 线上有 hash → 拒绝旧缓存，重取升级
{
  const h = harness({ manifest: 'HASH-A', catCount: 25 });
  h.store[h.KEY] = JSON.stringify({ v: 1, n: 12, e: BIG });   // 无 hash
  await h.inst.loadAll();
  const rec = JSON.parse(h.store[h.KEY]);
  ok(h.stat.cats === 12 && rec.hash === 'HASH-A', '旧格式缓存被拒 → 重取并升级带指纹');
}

// ⑥ 全量成功 → 缓存写入且带 hash
{
  const h = harness({ manifest: 'HASH-C', catCount: 25 });
  await h.inst.loadAll();
  const rec = JSON.parse(h.store[h.KEY] || '{}');
  ok(rec.hash === 'HASH-C' && rec.n === 12 && rec.e.length === 300,
    `全量 → 缓存带指纹（hash=${rec.hash}, n=${rec.n}, e=${rec.e && rec.e.length}）`);
}

console.log(fail ? `✗ 失败 ${fail} 项` : '✓ data-cache 全部通过');
process.exitCode = fail ? 1 : 0;
