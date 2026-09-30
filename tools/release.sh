#!/bin/sh
# release.sh · 一键发版：校验 → 合并 → 构建 → 打包 → 测试 → 上传
# 用法: sh tools/release.sh [--no-deploy]
set -e
cd "$(dirname "$0")/.."

echo "════ 1/7 语料打捞与归一 ════"
node tools/repair.mjs | tail -3
node tools/merge.mjs | tail -4
node tools/normalize.mjs | tail -2

echo ""
echo "════ 2/7 语料校验 ════"
node tools/verify.mjs | tail -6 || { echo "校验未通过，中止。"; exit 1; }

echo ""
echo "════ 3/7 引擎自测 ════"
node tools/selftest.mjs | tail -3

echo ""
echo "════ 4/7 全量回归 ════"
node tools/smoke.mjs | tail -24

echo ""
echo "════ 5/7 静态审计 ════"
node tools/audit.mjs | tail -5

echo ""
echo "════ 6/7 打包 ════"
node tools/build.mjs | tail -4
python3 tools/csp.py | tail -2
python3 tools/build-worker.py | tail -3
# 发版守卫：functions/api/ai-dream.js 必须与 dist/worker.mjs 同步（无管道，退出码生效）
python3 tools/make-function.py --check

echo ""
echo "════ 7/7 Worker 行为测试 + 页面端到端 ════"
node tools/test-worker.mjs | tail -2
node tools/e2e.mjs | tail -2

if [ "$1" = "--no-deploy" ]; then
  echo ""
  echo "（--no-deploy：跳过上传）"
  exit 0
fi

echo ""
echo "════ 上传 Cloudflare Workers ════"
python3 tools/build-worker.py --deploy
