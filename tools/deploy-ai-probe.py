#!/usr/bin/env python3
"""deploy-ai-probe.py · 上传带 AI 绑定的探针 Worker 并调用它

上传 multipart 结构：metadata 里带 bindings:[{type:ai,name:AI}]，
worker.mjs 里用 env.AI.run()。这样完全不依赖 CI token 的 AI 权限——
AI 走的是账号自身的 Workers AI 配额。
"""
import json
import os
import urllib.error
import urllib.request

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist', 'ai-probe.mjs')
NAME = 'ai-probe-jiemeng'


def call(url, method, data=None, ctype=None, timeout=180):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN'])
    req.add_header('User-Agent', 'minis-probe/1.0')
    if ctype:
        req.add_header('Content-Type', ctype)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {'raw': body[:500]}


def main():
    acct = os.environ['CLOUDFLARE_ACCOUNT_ID']
    body = open(SRC, 'rb').read()
    meta = {
        'main_module': 'worker.mjs',
        'compatibility_date': '2026-09-01',
        'bindings': [{'type': 'ai', 'name': 'AI'}],
    }
    b = '----minisai7f3a'
    parts = [
        ('--' + b + '\r\nContent-Disposition: form-data; name="metadata"\r\n'
         'Content-Type: application/json\r\n\r\n').encode(),
        json.dumps(meta).encode(),
        ('\r\n--' + b + '\r\nContent-Disposition: form-data; name="worker.mjs"; '
         'filename="worker.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n').encode(),
        body,
        ('\r\n--' + b + '--\r\n').encode(),
    ]
    payload = b''.join(parts)
    url = 'https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s' % (acct, NAME)
    st, res = call(url, 'PUT', payload, 'multipart/form-data; boundary=' + b)
    print('上传:', st, res.get('success'))
    if not res.get('success'):
        print(json.dumps(res.get('errors'), ensure_ascii=False)[:600])
        return 1

    sub = res['result'].get('subdomain') or '5202013'
    call('https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s/subdomain' % (acct, NAME),
         'POST', json.dumps({'enabled': True}).encode(), 'application/json', 60)
    print('启用路由: https://%s.%s.workers.dev/' % (NAME, sub))

    print('\n调用探针（首次调用会创建 AI 绑定，可能稍慢）…')
    st, out = call('https://%s.%s.workers.dev/' % (NAME, sub), 'GET', timeout=240)
    print(json.dumps(out, ensure_ascii=False, indent=2)[:2000])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
