# 周公解梦 · 梦境详解

纯前端静态站：输入梦境描述，按**传统周公解梦**与**心理学象征**双线逐象拆解，给出吉凶定级与预兆维度分布。
零后端、零外部请求、梦境内容只在本机浏览器计算。

- 线上：https://zhougongjiemeng.pages.dev/ （旧地址 jiemeng.5202013.workers.dev 为 308 跳转）
- 语料：1045 个梦象符号 / 6900+ 别名 / 6000+ 情境分述
- 部署：Cloudflare Pages（git 集成，push 即构建）+ Pages Functions 承载 AI 端点

---

## 架构

```
data/          语料源（12 个分类，每类一个 JSON）
tools/         构建与验证工具链
web/           部署目录（index.html / style.css / js/ / data/ / version.json / 静态资源）
functions/     Pages Functions（api/ai-dream.js，由 make-function.py 从 Worker 模板生成）
dist/          Worker 打包产物（不入库；现职责仅为旧域 308 跳转）
```

### 运行链路

```
用户输入
  → engine.matchText()      主键 + 别名，按长度降序、区间不重叠匹配
  → engine.pickScene()      用命中位置周边的上下文窗口，在情境表里挑最贴的一条
  → engine.interpret()      各象按具体程度与句中位置加权 → 综合分 → 等级 + 维度分布
  → app.js                  渲染总断 / 逐象卡片 / 翻梦书 / 本机记录
```

`engine.js` 是**纯函数、零 DOM** 的：既能被浏览器跑，也能被 Node 直接 import 做回归测试。

---

## 工具链

| 工具 | 作用 |
|---|---|
| `tools/verify.mjs` | 语料质量闸门：字段完整性、枚举、长度区间、主键重复、分类一致性 |
| `tools/repair.mjs` | 容错打捞：大 JSON 分片写入留下的残尾，按括号配平逐条救回 |
| `tools/merge.mjs` | 分片合并 + 同类去重 + 跨类同键并入高优先级类别 |
| `tools/normalize.mjs` | 字段归一：枚举同义词、吉凶档位夹紧、别名去重 |
| `tools/selftest.mjs` | 引擎单元测试（合成语料，不依赖真实数据） |
| `tools/smoke.mjs` | 全量回归：识别率、分数分位、等级分布、维度覆盖、性能 |
| `tools/audit.mjs` | 静态审计：引用闭合、DOM id 闭合、类名闭合、触控目标、溢出、安全 |
| `tools/build.mjs` | 语料同步到 `web/data/` + 生成 manifest |
| `tools/csp.py` | 计算内联脚本 sha256 并写入 `_headers` 的 CSP |
| `tools/build-worker.py` | 打包成单文件 Worker，`--deploy` 时上传 |
| `tools/test-worker.mjs` | Worker 行为测试：路由、MIME、缓存头、安全头、308、404、逐字节比对、AI 端点（mock env） |
| `tools/e2e.mjs` | 真实页面端到端测试（jsdom）：启动→解梦→翻梦书→历史→深链→注入防御 |
| `tools/bundle-classic.mjs` | 把 ES module 合成经典脚本，供 jsdom 注入（仅测试用） |
| `tools/release.sh` | 一键发版：校验 → 合并 → 自测 → 回归 → 审计 → 打包 → 测试 → 上传 |
| `tools/setup-pages.py` | 创建/更新 Pages 项目（git 集成），带出口抖动重试 |
| `tools/make-function.py` | 从 `dist/worker.mjs` 逐字节提取生成 Pages Function；`--check` 校验同步（漂移即发版失败） |
| `tools/evolve.mjs` | 语料进化聚合：拉取意象遥测 → 与梦书差集 → 产出待审候选 |

```sh
sh tools/release.sh            # 全流程 + 上传
sh tools/release.sh --no-deploy  # 只到本地打包
```

---

## 语料格式

见 `SCHEMA.md`。单条：

```json
{
  "k": "蛇", "c": "animal", "g": 1,
  "nm": ["蟒蛇", "长虫", "毒蛇"],
  "ct": "传统断语",
  "ps": "心理象征",
  "sc": [{ "s": "被蛇追咬", "v": "情境断语" }],
  "tg": ["财运", "心绪"]
}
```

`g` 吉凶倾向：`-2` 大凶 / `-1` 凶 / `0` 平 / `1` 吉 / `2` 大吉 —— 来自传统断语的实际分化，不是一概而论。

---

## 部署

主部署走 **Cloudflare Pages git 集成**（本账户 Direct Upload 通道不可用，实测 500）：

```sh
git push origin main          # Pages 自动构建（产物目录 web/，函数目录 functions/）
python3 tools/setup-pages.py --owner ijmu --repo zhougongjiemeng   # 仅首次建项目
```

线上地址由 **Pages 工程名**决定（`zhougongjiemeng` → `zhougongjiemeng.pages.dev`），与仓库名无关。
AI/KV 绑定配在 Pages 项目的 `deployment_configs`（`ai_bindings.AI` + `kv_namespaces.RL`）。

旧 Workers 地址仅作 **308 整站跳转**（保路径/查询/方法），不再承载内容与 API——
避免留下不更新的陷阱地址。单文件 Worker 打包行为（MIME/安全头/CSP/308/404）保留在
`tools/build-worker.py` 供测试与跳转 Worker 使用。
CSP 的 `script-src` 用**内联脚本 sha256** 而非 `unsafe-inline`；改 `index.html` 内联脚本后必须重跑 `tools/csp.py`。

### 发版守卫（release.sh 内置）

- `make-function.py --check`：`functions/api/ai-dream.js` 与 `dist/worker.mjs` 逐字节同步，漂移即中止
- audit.mjs：隐私契约断言（AI 例外披露、意象遥测披露）+ SEO 自指域名一致性
- build.mjs 自动维护 `index.html` 的 `?v=` 内容哈希戳（改码忘改戳是不可能的了）

---

## AI 补读（未命中时的兜底）

梦书未收录的说法，可在用户**主动勾选同意后**交给 AI 解读。

### 为什么默认关闭

这个站的核心卖点是「梦境只在本机计算」。梦境是最私密的一类输入，
默认全量外呼会把「不上传」变成一句假话。所以：

- **默认路径全本地**，不联网、不发任何请求
- 只有勾选「我明白梦境将发送到服务器」后，按钮才可用
- 服务端**强制校验 `consent` 标记**，缺失一律 403 —— 守门在服务端，不靠前端自觉
- 隐私文案同步披露了这个唯一例外

### 平台与模型

用 **Cloudflare Workers AI**（与站点同平台，无需额外密钥）：

```python
'bindings': [{'type': 'ai', 'name': 'AI'},
             {'type': 'kv_namespace', 'name': 'RL', 'namespace_id': ...}]
```

关键点：**AI 绑定走账号自身的 Workers AI 配额，不依赖 CI token 的 AI 权限**
（实测 token 直调 `/ai/run` 返回 `401 Authentication error`，但绑定完全可用）。

默认模型 `@cf/meta/llama-3.1-8b-instruct-fast`（实测约 1.4s）。可选
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`（质量更好，约 1.8s）。
注意 `@cf/google/gemma-3-12b-it` 本账号无权访问；旧的 `instruct` 系列已于 2026-05-30 弃用。

### 输出红线（必需，不是可选项）

实测不加约束时，模型会直接输出「**可能预示着亲人离世**」「会有健康问题」——
这类内容在解梦产品里不可接受。所以做了两层：

1. **提示词硬约束**：禁止预言死亡、绝症、具体疾病、灾祸；涉及此类传统说法一律改写成心理层面的「焦虑」「不安」
2. **输出侧兜底 `soften()`**：命中灾祸预言句式则改写为心理表述，防止提示词被绕过

### 限流

免费配额必须设闸门。KV 按 `IP·天` 计数（键 `ai:YYYY-MM-DD:<ip>`），**每日 8 次**，超限 429。
无 KV 绑定时退化为不限流（仍受 Workers AI 总配额约束）。

### 意象遥测（进化闭环的数据源）

提示词要求模型在解读末行输出 `【意象】词、词、词`。Function 提取后：

- **只把意象词匿名计数**进 KV（键 `evo:YYYY-MM-DD`，90 天 TTL），梦境原文绝不落盘
  （切分规则：任意非汉字字符都是分隔——实测模型用过 `、` `#` `·` `•`，甚至不打分隔符）
- 返回给用户前剥离该行，用户无感
- 文案同步披露「核心意象词会被匿名计数、原文不留存」，audit 有契约断言

## 自动进化闭环

```
未命中 → 用户同意 AI 补读 → 【意象】提取 → KV 匿名计数（自动，运行时）
       → node tools/evolve.mjs [--min N] [--days D]   聚合 + 与梦书差集
       → _evolve-candidates.json（仓库根，gitignore）  待审候选
       → 人工审阅补全 ct/ps/sc → 并入对应 data/*.json → 正常发版
```

**候选绝不自动并入**——AI 幻觉污染梦书的代价远大于人审成本，闭环自动化到「浮出水面」为止。
注意：候选文件绝不放进 `data/`（五个工具 glob 该目录，会被当语料发货）。

## 客户端自更新

`build.mjs` 每次构建产出 `web/version.json`（与 index.html 的 `?v=` 同源同值）。
长开的旧标签页回前台时（5 分钟节流）比对自身 `<script src>` 的戳与服务端版本，
不一致则弹 toast 一键刷新——补上「HTML 每次都新、JS 只在加载时固定」的最后一环。

---

## 边界

内容为传统民俗解梦说法与心理学象征理论的**文化娱乐参考**，不构成医学、心理、投资、法律建议。
梦提示状态，不预告命运。AI 解读同样受此约束，并额外禁止灾祸类断言。
