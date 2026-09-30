/**
 * /api/ai-dream · 梦境解读外呼（Pages Functions 版）
 *
 * 本文件由 tools/make-function.py 从 dist/worker.mjs 程序化提取生成——
 * 处理逻辑与已上线的 Worker 版逐字节一致，不要手改；
 * 要改行为请改 build-worker.py 里的模板，重新构建后运行本脚本再生成。
 *
 * 绑定（Pages 项目 deployment_configs）：env.AI = Workers AI；env.RL = KV 限流
 */

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}

/* 非 POST 一律 405（与 Worker 版一致）——
   Pages Functions 若只导出 onRequestPost，GET 会落回静态 404，语义就错了 */
export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return aiDream(request, env);
}

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
    '最后单独一行输出【意象】加 2–4 个核心意象词（顿号分隔），便于归档，不要任何解释',
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
    let text = (r && (r.response || r.result)) || '';
    if (!text) return json({ error: 'empty_response' }, 502);

    // 提取末行【意象】：只把意象词做匿名计数（梦境原文绝不落盘），并从返回文本剥离。
    // 这是语料进化的数据源：未被梦书收录的说法经 AI 点名后，高频意象自动浮出为增补候选。
    let evoN = 0;
    {
      const ls = String(text).split('\n').map(s => s.trim()).filter(Boolean);
      const last = ls.length && /^【意象】/.test(ls[ls.length - 1]) ? ls.pop() : '';
      if (last) {
        const ws = last.replace(/^【意象】/, '').split(/[、,，;；#/\s·．.]+/)
          .map(s => clean(s, 12))
          .filter(s => s && /[\u4e00-\u9fa5]/.test(s))   // 含汉字即收——蛇/水等单字核心意象不能滤
          .slice(0, 4);
        text = ls.join('\n');
        evoN = ws.length;
        if (env.RL && evoN) {
          try {
            const dk = 'evo:' + day;
            const bag = JSON.parse((await env.RL.get(dk)) || '{}');
            for (const w of ws) bag[w] = (bag[w] || 0) + 1;
            await env.RL.put(dk, JSON.stringify(bag), { expirationTtl: 7776000 });
          } catch (e) { /* 遥测失败不阻断解读 */ }
        }
      }
    }

    // 输出侧兜底：命中死亡/疾病类词汇则改写为心理表述（防止提示词被绕过）
    const safe = soften(text);
    return json({ ok: true, text: safe, model: model, ms: Date.now() - t0, softened: safe !== text, evo: evoN });
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
