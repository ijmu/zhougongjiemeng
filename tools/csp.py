#!/usr/bin/env python3
"""把 web/index.html 里内联 <script> 的 sha256 写进 web/_headers 的 CSP。

CSP 里用哈希而不是 'unsafe-inline'：既允许那一段看门狗脚本，又保持"除白名单外一律禁止内联脚本"。
每次改动 index.html 的内联脚本后必须重跑本脚本，否则线上脚本会被浏览器拦掉。

用法: python3 tools/csp.py           # 计算并写入
      python3 tools/csp.py --check   # 只校验，不写
"""
import base64
import hashlib
import re
import sys
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
HTML = os.path.join(ROOT, 'index.html')
HEAD = os.path.join(ROOT, '_headers')


def inline_scripts(html):
    """取所有 <script> ... </script>（无 src 属性）的内容，按 CSP 规则计算哈希。
    CSP 的哈希是对元素内容逐字节计算，不含 <script> 标签本身。"""
    out = []
    for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S | re.I):
        out.append(m.group(1))
    return out


def digest(s):
    return 'sha256-' + base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode()


def main():
    check = '--check' in sys.argv
    html = open(HTML, encoding='utf-8').read()
    scripts = inline_scripts(html)
    if not scripts:
        print('未发现内联脚本；请把 CSP 的 script-src 改回 \'self\'')
        return 1
    hashes = [digest(s) for s in scripts]
    print('内联脚本 %d 段：' % len(hashes))
    for h, s in zip(hashes, scripts):
        print('  %s  (%d bytes)' % (h, len(s.encode())))

    head = open(HEAD, encoding='utf-8').read()
    m = re.search(r"script-src([^;]*);", head)
    if not m:
        print('✗ _headers 里找不到 script-src')
        return 1
    cur = m.group(1).strip()
    want = "'self' " + ' '.join("'%s'" % h for h in hashes)
    if cur == want:
        print('✓ CSP 已一致，无需修改')
        return 1 if check else 0
    if check:
        print('✗ CSP 不一致\n  现在: %s\n  应为: %s' % (cur, want))
        return 1
    head = head[:m.start(1)] + ' ' + want + head[m.end(1):]
    open(HEAD, 'w', encoding='utf-8').write(head)
    print('✓ 已写入 _headers')
    # 回读校验，避免写出半截文件
    back = open(HEAD, encoding='utf-8').read()
    m2 = re.search(r"script-src([^;]*);", back)
    assert m2 and m2.group(1).strip() == want, '回读不一致'
    print('✓ 回读一致')
    return 0


if __name__ == '__main__':
    sys.exit(main())
