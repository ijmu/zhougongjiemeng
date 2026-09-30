#!/usr/bin/env python3
"""setup-pages.py · 把本项目接上 Cloudflare Pages 的 git 集成通道

背景（重要环境事实）：
  本账户的 Pages **Direct Upload 通道不可用**（最小项目实测同样 500），
  但 **git 集成正常**。所以要用 Pages，必须先有一个 GitHub 仓库。

本脚本假定仓库已存在（GH_TOKEN 无建库权限，需在 github.com/new 手动创建），
然后用 CF API 建 Pages 项目并把 production_branch 指向它。

用法:
  python3 tools/setup-pages.py --owner ijmu --repo jiemeng
  python3 tools/setup-pages.py --owner ijmu --repo jiemeng --deploy   # 建完后推一次提交触发构建
"""
import argparse
import json
import os
import urllib.error
import urllib.request

API = 'https://api.cloudflare.com/client/v4'
PROJECT = 'jiemeng'


def gh(path):
    token = os.environ.get('GH_TOKEN')
    req = urllib.request.Request('https://api.github.com' + path)
    req.add_header('Authorization', 'token ' + token)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('User-Agent', 'minis-setup/1.0')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return {'__error__': e.code, 'body': e.read().decode(errors='replace')[:400]}


def cf(path, method='GET', payload=None):
    token = os.environ['CLOUDFLARE_API_TOKEN']
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('User-Agent', 'minis-setup/1.0')
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        try:
            return json.loads(body)
        except Exception:
            return {'success': False, 'errors': [{'message': body[:500]}]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--repo', required=True)
    ap.add_argument('--branch', default='main')
    ap.add_argument('--name', default=PROJECT)
    args = ap.parse_args()

    print('① 读取 GitHub 仓库信息（owner_id / repo_id 是 CF 必需的）')
    info = gh('/repos/%s/%s' % (args.owner, args.repo))
    if '__error__' in info:
        raise SystemExit('✗ 读不到仓库 %s/%s：%s\n（GH_TOKEN 无建库权限，请先到 github.com/new 手动创建）'
                         % (args.owner, args.repo, info['__error__']))
    owner_id = str(info['owner']['id'])
    repo_id = str(info['id'])
    print('   owner_id=%s repo_id=%s default_branch=%s' % (owner_id, repo_id, info.get('default_branch')))

    print('② 取 Cloudflare 账户')
    accts = cf('/accounts')
    if not accts.get('success') or not accts.get('result'):
        raise SystemExit('✗ 取不到账户: %s' % json.dumps(accts.get('errors'), ensure_ascii=False))
    acct = accts['result'][0]['id']
    print('   account=%s' % acct)

    print('③ 检查项目是否已存在')
    cur = cf('/accounts/%s/pages/projects/%s' % (acct, args.name))
    if cur.get('success'):
        print('   项目已存在，改为更新 source')
        method, path = 'PATCH', '/accounts/%s/pages/projects/%s' % (acct, args.name)
    else:
        method, path = 'POST', '/accounts/%s/pages/projects' % acct

    # source 结构照抄本账户已跑通的 kline-jianghu，不猜字段
    payload = {
        'name': args.name,
        'production_branch': args.branch,
        'source': {
            'type': 'github',
            'config': {
                'owner': args.owner,
                'owner_id': owner_id,
                'repo_name': args.repo,
                'repo_id': repo_id,
                'production_branch': args.branch,
                'deployments_enabled': True,
                'production_deployments_enabled': True,
                'pr_comments_enabled': True,
                'preview_deployment_setting': 'all',
                'preview_branch_includes': ['*'],
                'preview_branch_excludes': [],
                'path_includes': ['*'],
                'path_excludes': [],
            },
        },
        # 本站无构建步骤：web/ 就是产物目录
        'build_config': {'build_command': '', 'destination_dir': 'web', 'root_dir': ''},
    }

    print('④ %s 项目' % ('更新' if method == 'PATCH' else '创建'))
    res = cf(path, method=method, payload=payload)
    if not res.get('success'):
        print('✗ 失败: %s' % json.dumps(res.get('errors'), ensure_ascii=False)[:900])
        return 1
    sub = (res['result'].get('subdomain') or args.name)
    print('   ✓ 项目就绪: https://%s.pages.dev/' % sub)
    if not res['result'].get('latest_deployment'):
        print('   ! 尚无部署记录 —— 需要向 %s 推一个提交才会触发首次构建' % args.branch)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
