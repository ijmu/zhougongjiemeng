#!/usr/bin/env python3
"""make-function.py · 从 dist/worker.mjs 原样提取 AI 处理器，生成 Pages Function

为什么不用手抄：转写会引入变量名/拼写偏差，而且这段代码已在线上运行过，
是最可靠的参照。本脚本只做两件事：
  1. 逐字节搬运 json/clean/buildPrompt/ld/aiDream/SOFTEN/soften
  2. 加一层 Pages Functions 的导出壳（onRequestPost/onRequestOptions，req→request）
"""
import re
import sys

src = open('dist/worker.mjs', encoding='utf-8').read()
lines = src.split('\n')


def block(start_pat, end_pat=None):
    """取从 start_pat 所在行到 end_pat 所在行（默认到闭合大括号）的原文"""
    s = next(i for i, l in enumerate(lines) if re.search(start_pat, l))
    if end_pat:
        e = next(i for i, l in enumerate(lines[s:], s) if re.search(end_pat, l))
        return '\n'.join(lines[s:e + 1])
    depth = 0
    for i in range(s, len(lines)):
        depth += lines[i].count('{') - lines[i].count('}')
        if depth == 0 and i > s:
            return '\n'.join(lines[s:i + 1])
    raise SystemExit('未闭合: ' + start_pat)


parts = [
    block(r'^function json\('),
    block(r'^/\* 输入过滤', r'^}'),
    block(r'^/\* 提示词', r'^}'),          # buildPrompt 连注释
    block(r'^async function ld\('),
    block(r'^async function aiDream\('),
    block(r'^/\* 兜底改写', r'^\];'),
    block(r'^function soften\('),
]

header = """/**
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

"""

out = header + '\n\n'.join(parts) + '\n'
if '--check' in sys.argv:
    """只校验 functions/api/ai-dream.js 是否与当前 dist/worker.mjs 同步（发版守卫）"""
    try:
        cur = open('functions/api/ai-dream.js', encoding='utf-8').read()
    except FileNotFoundError:
        cur = ''
    if cur != out:
        import difflib
        diff = '\n'.join(list(difflib.unified_diff(
            cur.splitlines(), out.splitlines(),
            '已提交的 function', '应生成的 function', lineterm=''))[:30])
        print('✗ functions/api/ai-dream.js 与 dist/worker.mjs 不同步 —— '
              '改了 Worker 模板却没重新生成 Function\n' + diff)
        raise SystemExit(1)
    print('✓ Pages Function 与 Worker 产物同步')
    raise SystemExit(0)

open('functions/api/ai-dream.js', 'w', encoding='utf-8').write(out)
print('生成 functions/api/ai-dream.js:', len(out), '字节')
