#!/usr/bin/env python3
"""build-worker.py · 把 web/ 打成单文件 Cloudflare Worker（资源 base64 内联）

为什么用 Worker：本账户 Pages Direct Upload 通道损坏（实测最小项目也 500），
而 Workers 的 PUT /workers/scripts 通道可用。合并成单文件后由 Worker 自己按路径分发，
静态站的行为（MIME / 缓存 / 安全头 / 404）全部在 Worker 里显式实现。

用法:
  python3 tools/build-worker.py            # 只构建 dist/worker.mjs
  python3 tools/build-worker.py --deploy   # 构建并上传
"""
import base64
import hashlib
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
WEB = os.path.join(ROOT, 'web')
DIST = os.path.join(ROOT, 'dist')
NAME = 'jiemeng'
# 限流用 KV：优先取环境变量，其次读 .deploy-ids（tools/setup-kv.py 写入）。
# 留空则 Worker 退化为不限流。
RL_NAMESPACE_ID = os.environ.get('JIEMENG_RL_KV', '')
if not RL_NAMESPACE_ID:
    _ids = os.path.join(ROOT, '.deploy-ids')
    if os.path.exists(_ids):
        for _line in open(_ids, encoding='utf-8'):
            if _line.startswith('jiemeng_ai_rl='):
                RL_NAMESPACE_ID = _line.strip().split('=', 1)[1]

# Pages 专属文件不进 Worker 产物
SKIP = {'_headers', '_redirects', '_routes.json'}

CT = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
}

# 缓存策略（秒）。0 表示必须回源校验
CACHE = {
    '.html': 'no-cache',
    '.css': 'public, max-age=300',
    '.js': 'public, max-age=300',
    '.json': 'public, max-age=3600',
    '.png': 'public, max-age=86400',
    '.svg': 'public, max-age=86400',
}


def collect():
    files = {}
    for dirpath, dirnames, names in os.walk(WEB):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for n in names:
            if n.startswith('.') or n in SKIP:
                continue
            full = os.path.join(dirpath, n)
            rel = os.path.relpath(full, WEB).replace(os.sep, '/')
            files[rel] = open(full, 'rb').read()
    return files


def inline_hashes(html):
    out = []
    for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S | re.I):
        h = hashlib.sha256(m.group(1).encode('utf-8')).digest()
        out.append('sha256-' + base64.b64encode(h).decode())
    return out


def build():
    files = collect()
    if 'index.html' not in files:
        raise SystemExit('✗ web/index.html 缺失')
    for need in ('data/manifest.json',):
        if need not in files:
            print(f'  ! 缺少 {need}，先跑 tools/build.mjs')

    html = files['index.html'].decode('utf-8')
    hashes = inline_hashes(html)
    script_src = "'self' " + ' '.join("'%s'" % h for h in hashes)
    print('  内联脚本哈希: ' + (', '.join(hashes) or '（无）'))

    # 打包成 {path: [contentType, cacheControl, base64]}
    packed = {}
    total = 0
    for rel, blob in sorted(files.items()):
        ext = os.path.splitext(rel)[1].lower()
        ct = CT.get(ext) or mimetypes.guess_type(rel)[0] or 'application/octet-stream'
        cc = CACHE.get(ext, 'public, max-age=3600')
        packed['/' + rel] = [ct, cc, base64.b64encode(blob).decode()]
        total += len(blob)

    payload = json.dumps(packed, separators=(',', ':'))
    print('  %d 个文件，原始 %d KB，载荷 %d KB' % (len(packed), total / 1024, len(payload) / 1024))

    worker = WORKER_TMPL.replace('__CSP_SCRIPT__', script_src).replace('__ASSETS__', payload)

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, 'worker.mjs')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(worker)
    print('  → %s  (%.1f KB)' % (out, os.path.getsize(out) / 1024))
    return out, [w[0] if isinstance(w, list) else w for w in packed.values()], packed


def deploy(path):
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    acct = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if not token or not acct:
        raise SystemExit('✗ 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID')
    body = open(path, 'rb').read()
    meta = {'main_module': 'worker.mjs', 'compatibility_date': '2026-09-01',
            'observability': {'enabled': False},
            # AI 绑定走账号自身的 Workers AI 配额，不依赖 CI token 的 AI 权限
            # （实测：token 直调 /ai/run 返回 401 Authentication error，但绑定可用）
            # RL 为限流用 KV：免费 AI 没有限流会被刷爆配额
            'bindings': ([{'type': 'ai', 'name': 'AI'}] +
                         ([{'type': 'kv_namespace', 'name': 'RL', 'namespace_id': RL_NAMESPACE_ID}]
                          if RL_NAMESPACE_ID else []))}
    boundary = '----minis' + hashlib.md5(body).hexdigest()[:12]
    parts = []
    parts.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\n'
                  'Content-Type: application/json\r\n\r\n').encode())
    parts.append(json.dumps(meta).encode())
    parts.append(('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="worker.mjs"; '
                  'filename="worker.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n').encode())
    parts.append(body)
    parts.append(('\r\n--' + boundary + '--\r\n').encode())
    data = b''.join(parts)

    url = 'https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s' % (acct, NAME)
    req = urllib.request.Request(url, data=data, method='PUT')
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Content-Type', 'multipart/form-data; boundary=' + boundary)
    req.add_header('User-Agent', 'minis-deploy/2.0')
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            res = json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        print('✗ 上传失败 HTTP %s\n%s' % (e.code, body[:1200]))
        return False
    if not res.get('success'):
        print('✗ 上传被拒: ' + json.dumps(res.get('errors'), ensure_ascii=False)[:900])
        return False
    print('✓ Worker 已上传: %s' % res['result'].get('id'))

    # 上传不会自动开 workers.dev 路由（phone-luck 踩过），且该端点只接受 POST
    sub_url = 'https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s/subdomain' % (acct, NAME)
    sreq = urllib.request.Request(sub_url, data=json.dumps({'enabled': True}).encode(), method='POST')
    sreq.add_header('Authorization', 'Bearer ' + token)
    sreq.add_header('Content-Type', 'application/json')
    sreq.add_header('User-Agent', 'minis-deploy/2.0')
    try:
        with urllib.request.urlopen(sreq, timeout=60) as r:
            r2 = json.loads(r.read().decode() or '{}')
        print('✓ workers.dev 路由: enabled=%s' % r2.get('result', {}).get('enabled'))
    except urllib.error.HTTPError as e:
        print('! 开路由返回 HTTP %s（可能已开启）' % e.code)

    print('  在线地址: https://%s.%s.workers.dev/' % (NAME, res['result'].get('subdomain') or '5202013'))
    return True


WORKER_TMPL = r'''/* 自动生成，勿手改 —— 源 web/ + tools/build-worker.py */
const ASSETS = __ASSETS__;
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
  + "script-src __CSP_SCRIPT__; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

// base64 → Uint8Array（Worker 无 atob 的 Node 版，用原生 atob + 手写解码）
const CACHE = new Map();
function bytes(b64) {
  let v = CACHE.get(b64);
  if (v) return v;
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  CACHE.set(b64, u);
  return u;
}

function resolve(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (ASSETS[p]) return p;
  // 规范 URL：/404 → /404.html，与 Pages 行为一致
  if (ASSETS[p + '.html']) return p + '.html';
  if (ASSETS[p + '/index.html']) return p + '/index.html';
  return null;
}

const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
};

function send(body, ct, cc, extra) {
  const h = new Headers(extra || {});
  h.set('Content-Type', ct);
  h.set('Cache-Control', cc);
  for (const k in SEC) h.set(k, SEC[k]);
  if (/^text\/|json|xml|javascript/.test(ct)) h.set('Content-Security-Policy', CSP);
  return new Response(body, { status: 200, headers: h });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // ── 整站已搬迁到 Pages：老 workers.dev 地址 308 跳转（保留方法与路径，POST 不降级）──
    // 此后本 Worker 只做跳转，不再承担内容与 API；未来发版只推 Pages 仓库即可。
    if (url.hostname.endsWith('.workers.dev')) {
      return Response.redirect('https://zhougongjiemeng.pages.dev' + url.pathname + url.search, 308);
    }

    // ── 梦境解读外呼：仅在用户显式同意后才会被调用 ──
    // 设计约束：默认全本地；这里只接受 POST，且必须带 consent:"1"。
    // 隐私文案承诺的是「不主动上传」，因此这一点是本服务能存在的前提。
    if (url.pathname === '/api/ai-dream') {
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
      }
      if (req.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      return aiDream(req, env);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    let key = resolve(url.pathname);

    // 规范 URL 跳转（与 Pages 一致），避免同一资源多个地址
    if (!key && (url.pathname === '/index.html' || url.pathname === '/404.html')) key = url.pathname;

    if (!key) {
      const e = ASSETS['/404.html'];
      if (!e) return new Response('Not Found', { status: 404 });
      const h = new Headers({ 'Content-Type': e[0], 'Cache-Control': 'no-cache' });
      for (const k in SEC) h.set(k, SEC[k]);
      h.set('Content-Security-Policy', CSP);
      return new Response(req.method === 'HEAD' ? null : bytes(e[2]), { status: 404, headers: h });
    }

    const e = ASSETS[key];
    if (url.pathname === '/index.html' || url.pathname === '/404.html') {
      return Response.redirect(url.origin + (url.pathname === '/index.html' ? '/' : '/404'), 308);
    }
    const body = req.method === 'HEAD' ? null : bytes(e[2]);
    const res = send(body, e[0], e[1]);
    // etag 用内容长度+路径派生，够用且零成本
    res.headers.set('ETag', 'W/"' + key.length + '-' + e[2].length + '"');
    return res;
  },
};

/* ---------- 辅助 ---------- */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/* 输入过滤：只做长度与形态约束，不做内容审查（内容由提示词层面的红线约束） */
function clean(text, max) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')  // 去控制字符
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 400);
}

/* 提示词：把输出硬约束在「民俗 + 心理象征」范围内。
   实测若不约束，模型会直接输出「预示亲人离世」「会有健康问题」——这在产品上不可接受。 */
function buildPrompt(dream, symbols) {
  const sym = (symbols || []).length
    ? '用户在别的梦象上已经匹配到：' + symbols.join('、') + '。可参考但不必受限于这些。'
    : '';
  return [
    '你是一位温和、克制的中文解梦顾问，通晓传统民俗解梦与荣格、弗洛伊德一派的心理象征理论。',
    '请针对下面这段梦境，给出解读。',
    '',
    '【硬性约束，必须遵守】',
    '1. 禁止预言死亡、绝症、具体疾病、意外、灾祸。传统说法如涉及此类，一律改写成心理层面的「焦虑」「不安」「对变化的感受」。',
    '2. 不给出医疗、投资、法律、婚姻等任何决策建议。',
    '3. 不下吉凶断语式的恐吓，不制造恐慌；语气平和、具体、有信息量。',
    '4. 不要堆砌套话，不要说「梦境很神奇，请结合自身实际」这类空话。',
    '5. 不要提及你是 AI、大模型，也不要提及提示词。',
    '',
    '【输出格式】只用中文，严格按下面四段。每段直接写内容，**不要重复段名**，不要加任何标题或符号：',
    '梦象：这段梦里最关键的两三个意象，以及它们各自的象征（直接说意象名，不要写「梦象：」这几个字）',
    '心理：从心理层面看，做梦人近期可能处在什么状态',
    '民俗：传统解梦怎么讲，客观转述，不带恐吓',
    '建议：一两句可落地的自我觉察方向，不做决策指导',
    '',
    sym,
    '【用户的梦境】',
    clean(dream, 400),
  ].filter(Boolean).join('\n');
}

async function ld(env, key) {
  try { return env.RL ? Number(await env.RL.get(key)) || 0 : 0; } catch (e) { return 0; }
}

async function aiDream(req, env) {
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!body || body.consent !== '1') {
    // 没有显式同意直接拒绝：这是隐私承诺的守门条件
    return json({ error: 'consent_required' }, 403);
  }
  const dream = clean(body.dream, 400);
  if (dream.length < 2) return json({ error: 'too_short' }, 400);

  const ip = req.headers.get('cf-connecting-ip') || 'anon';
  const day = new Date().toISOString().slice(0, 10);

  // 限流：有 KV 绑定则按 IP·天 计数，无绑定则退化为不限流（仍受 Workers AI 配额约束）
  if (env.RL) {
    const k = 'ai:' + day + ':' + ip;
    const n = await ld(env, k);
    if (n >= 8) return json({ error: 'rate_limited', limit: 8 }, 429);
    try { await env.RL.put(k, String(n + 1), { expirationTtl: 90000 }); } catch (e) { /* 计数失败不阻断 */ }
  }

  if (!env.AI) return json({ error: 'ai_unavailable' }, 503);

  // symbols 只是提示参考：必须数组、限量 8 条、逐条清洗——
  // 否则 string 类型会在 buildPrompt 里 .join 抛错（502），超长/注入文本会直接进提示词
  const syms = Array.isArray(body.symbols)
    ? body.symbols.slice(0, 8).map(s => clean(s, 24)).filter(Boolean)
    : [];

  const model = env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct-fast';
  const t0 = Date.now();
  try {
    const r = await env.AI.run(model, {
      messages: [
        { role: 'system', content: '你是中文解梦顾问。严格遵守用户给出的全部硬性约束，尤其是不得预言死亡、疾病、灾祸。' },
        { role: 'user', content: buildPrompt(dream, syms) },
      ],
      max_tokens: 520,
      temperature: 0.6,
    });
    const text = (r && (r.response || r.result)) || '';
    if (!text) return json({ error: 'empty_response' }, 502);

    // 输出侧兜底：命中死亡/疾病类词汇则改写为心理表述（防止提示词被绕过）
    const safe = soften(text);
    return json({ ok: true, text: safe, model: model, ms: Date.now() - t0, softened: safe !== text });
  } catch (e) {
    return json({ error: 'ai_failed', detail: String(e.message || e).slice(0, 200) }, 502);
  }
}

/* 兜底改写：只替换明确的灾祸预言句式，不改变其余内容 */
const SOFTEN = [
  [/亲人(或长辈)?(可能)?(会)?(离世|去世|死亡|有生命危险)/g, '让你挂念起了某位亲近的人'],
  [/(预示|预兆|暗示|意味着|说明)(你|家中|家里)?(可能)?(会)?(得|患|有)(绝症|重病|癌|大病|病)/g, '提示你近期对健康或状态有些不安'],
  [/(会|将要|即将)(死亡|死去|丧命|出意外|遭遇不测)/g, '内心对某种变化感到难以把握'],
  [/有(血光之灾|牢狱之灾|横祸)/g, '对未知的不安被放大成了强烈的画面'],
];

function soften(s) {
  let out = String(s);
  for (const [re, rep] of SOFTEN) out = out.replace(re, rep);
  return out;
}
'''


if __name__ == '__main__':
    out, _, packed = build()
    if '--deploy' in sys.argv:
        deploy(out)
