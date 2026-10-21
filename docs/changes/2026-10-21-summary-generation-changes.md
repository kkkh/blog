# 2026-10-21 摘要生成流水线改动记录

本文记录 2026-10-21 这一天对本站「AI 摘要生成」相关代码与数据所做的全部改动，包括每一处的位置、改动前后内容、原因、作用、后果与验证结果。

> 记录时间：2026-10-21 11:25（Asia/Shanghai）
> 涉及仓库：`/Users/qinchao/Movies/qinchao`
> 摘要脚本当前行号以本文写作时为准（文件约 620 行）

---

## 0. 一句话摘要

把 `pnpm generate:summaries` 从「会被 429 打断、会写入半句摘要、等待时间写死」改成了「有节流与退避、有内容校验、三段等待可配置」，并在最后把接口从 `maas-api.unisound.com`（`u2-flash`）切换到火山方舟 Responses API（`doubao-seed-evolving`），用新模型重新生成了全部 80 篇摘要。

---

## 1. 文件清单与总览

| 文件 | 是否由我修改 | Git 状态 | 行数变化 | 最后修改时间（本地） |
| --- | --- | --- | --- | --- |
| `src/scripts/generateSummaries.ts` | 是 | `M` | **+332 / -8** | 2026-10-21 13:01:02 |
| `src/assets/summaries.json` | 是（生成产物） | `M` | **+306 / -6** | 2026-10-21 12:52:22 |
| `.cache/summaries-cache.json` | 是（缓存产物） | Git 忽略 | 条目 5 → 80 | 2026-10-21 12:52:22 |
| `.cache/summaries-cache.doubao-disabled.json` | 是（备份） | Git 忽略 | 新建 | 2026-10-21 12:09:28 |
| `.env` | 是（仅换 key） | Git 忽略 | 1 行值替换 | 2026-10-21 10:48:37 |
| `.cache/summaries-cache.u2-flash.json` | 是（备份） | Git 忽略 | 新建 | 2026-10-21 11:00:37 |
| `config/site.yaml` | **否**（你的友链改动） | `M` | +4 / -4 | 2026-10-21 09:04:01 |
| `src/assets/similarities.json` | **否**（我未执行该命令） | `M` | +1084 / -1084 | 2026-10-21 11:20:45 |

说明：

- `summaries.json` 与 `similarities.json` 都是压缩前的单行 JSON，重新生成时 Git 会按整文件计数，所以行数变化很大，不代表手工改了很多行。
- `.env`、`.cache/*` 均被 `.gitignore` 忽略（`.gitignore:18` 命中 `.env`），不会进入提交。
- 临时日志 `.tmp-summaries.log` 在每次运行后已删除，当前不存在。

---

## 2. 时间线（按阶段）

| 阶段 | 大致时间 | 做了什么 |
| --- | --- | --- |
| 用户首次全量运行（改动前） | 2026-10-21 00:54 左右 | 44 篇成功、33 篇 429 失败，耗时 200.2s |
| A. 限流改造 | 上午 | 新增请求间隔、429/5xx 退避重试 |
| B. 残句校验 | 上午 | 新增 `isTruncatedSummary` 与 `generateSummaryChecked` |
| C. 定位并绕开 xsai 缺陷 | 上午 | 新增 `LlmHttpError`、`generateSummaryDirect` |
| D. 等待时间可配置 | 上午 | 新增 3 个环境变量与启动打印 |
| 更新 `.env` | 10:48:37 | 换成火山方舟的 key |
| 备份旧数据 | 11:00:37 | 生成 `.cache/summaries-cache.u2-flash.json` |
| E. 切换新模型 | 10:59 - 11:58 | 改 base URL、模型名、Responses API；11:58 最终把思考设为 `enabled` + `effort: high` |
| 新模型试跑 3 篇 | 约 11:01 | 16.5s，3 篇全部通过校验 |
| 新模型全量重生成（关闭思考） | 约 11:13 - 11:20 | 448.2s，80 篇，0 错误 |
| 数据写入完成（第一版） | 11:20:36 | `summaries.json` / 缓存落盘 |
| A/B 测试与校验放宽 | 11:58 - 12:09 | 开启思考 + `effort: high`，4 篇复测全部 PASS |
| **思考模式全量重跑** | **12:09 - 12:52** | **2468.0s，79 篇成功、1 篇超时；补跑 29.8s 后 80/80** |
| 最终数据写入 | 12:52:22 | 全部 80 条为思考模式结果 |
| 超时调整 | 13:01:02 | `AbortSignal.timeout` 120s → 180s |

> 精确时间以文件 mtime 与脚本输出为准；同一阶段内的多次编辑没有逐次留痕，故按阶段归并。

---

## 3. 代码改动：`src/scripts/generateSummaries.ts`

总计 **新增 310 行、删除 8 行**。以下是按逻辑分组的逐处说明。

### 3.1 阶段 A：请求节流 + 429/5xx 退避重试

#### A1. 请求间隔常量与 `sleep`

- 位置：`L132-L168`、`L204`
- 类型：新增
- 原因：不改之前，脚本对接口没有任何节流。实测 200 秒内发出 77 次请求，其中 33 次被 `429 rate_limit_exceeded (rpm error)` 拒绝；一旦触发限流，后续请求会在同一秒内连续失败。
- 作用：每次真正调用模型前等待固定毫秒数，把瞬时速率压到接口限制以下。
- 代码：

```ts
const DEFAULT_REQUEST_INTERVAL_MS = 1_500;
const REQUEST_INTERVAL_ENV = 'SUMMARY_INTERVAL_MS';

function readNonNegativeMs(envName: string): number | null { /* ... */ }
function readRequestInterval(): number | null { /* ... */ }

const REQUEST_INTERVAL_MS = readRequestInterval() ?? DEFAULT_REQUEST_INTERVAL_MS;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
```

- 后果/影响：
  - 默认每次生成多等 1.5 秒；80 篇全量约多花 2 分钟。
  - 只影响「正在生成」的篇目，命中缓存的篇目不会等待。
  - 可通过 `SUMMARY_INTERVAL_MS` 调整，设为 `0` 表示不等待。

#### A2. 状态码提取 `getStatusCode`

- 位置：`L213`
- 类型：新增
- 原因：xsai 抛出的 `XSAIError` 把原始 `Response` 挂在 `error.response` 上，需要取出 `status` 才能判断是否可重试。
- 作用：统一读取 HTTP 状态码；网络中断、超时等没有 `response` 的错误返回 `undefined`。
- 后果：让后续重试逻辑只针对明确的 HTTP 错误生效。

#### A3. 可重试判定 `isRetryable`

- 位置：`L224`
- 类型：新增
- 代码：

```ts
function isRetryable(error: unknown): boolean {
  const status = getStatusCode(error);
  return status === 429 || (status !== undefined && status >= 500);
}
```

- 作用：只把 429（限流）与 5xx（服务端临时故障）视为可重试。
- 后果：
  - 401/403（key 无效）、400（请求格式错误）、404（模型名错误）立即失败，不空等。
  - 这类配置错误不会被重试掩盖，排查更快。

#### A4. 指数退避重试 `generateSummaryWithRetry`

- 位置：`L363` 起
- 类型：新增
- 原因：429 是暂时性的，等一个限流窗口通常就能恢复；原脚本第一次失败就放弃。
- 作用：失败后按 `15s → 30s → 60s → 120s → 240s` 等待并重试，最多 5 次（加首次共 6 次请求）。
- 后果/影响：
  - 单篇最坏等待约 465 秒（7 分 45 秒）。
  - 重试耗尽才抛出，外层 `catch` 记为 `Errors`。
  - 失败文章不写缓存，下次运行只会补缺口，不重复消耗已成功的条目。
  - 2026-10-21 起，该函数还接受一个可选第三参数（见 3.3），默认行为不变。

### 3.2 阶段 B：残句校验

#### B1. 判定规则与常量

- 位置：`L387-L399`、`L416-L435`
- 类型：新增
- 原因：旧接口会偶发只返回摘要的后半段，例如：
  - `linux-06-pipes-and-redirection` → `。`
  - `linux-21-scheduled-tasks` → `落 /etc/cron.d/。`
  - `binhe-greenway-rides` → `了多少”才是关键，最终落脚于……`
  - `reading-20-faust` → `结尾则靠“永远努力者可得救”作结。……`
- 作用：命中以下任一条件即判为残句：
  1. 为空；
  2. 以 `，。、；：”’）】》` 开头；
  3. 不足 40 字且不以常见句式起笔；
  4. 不以 `本文|文章|这篇|本|该文|作者|记录|讲述|书中|影片|《` 起笔（判定为丢了开头）；
  5. 结尾不是 `。！？`（判定为丢了结尾）。
- 代码（节选）：

```ts
const MIN_SUMMARY_LENGTH = 40;
const TRUNCATED_SUMMARY_START = /^[，。、；：”’）】》]/;
const SUMMARY_OPENERS = /^(本文|文章|这篇|本|该文|作者|记录|讲述|书中|影片|《)/;
const SUMMARY_END = /[。！？]$/;
const SUMMARY_CHECK_MAX_RETRIES = 4;

function isTruncatedSummary(summary: string): boolean { /* 上述 5 条规则 */ }
```

- 后果/影响：
  - 半句摘要不再进入缓存与 `summaries.json`。
  - 规则是启发式：**最初版本**要求以固定句式起笔，导致 `linux-23-containers-and-kernel-boundaries`（「容器并非虚拟机……」）、`mood-2022-03-01`（「三月一日作者……」）这类合法摘要被误判。该「固定起笔」规则已在开启思考后停用（代码以注释保留），开头完整性改由接口的 `status === completed` 保证。
  - 若 4 次重新生成都不合格，该篇本轮没有摘要并记 1 个 `Error`，下次运行会自动补。

#### B2. 带校验的生成 `generateSummaryChecked`

- 位置：`L438` 起
- 类型：新增
- 作用：在限流重试之外再套一层内容校验，残句最多重新生成 4 次，每次之间等待 `REGEN_DELAY_MS`；最后一次仍不合格则抛出。
- 后果：
  - 单篇最坏额外 4 次请求 + 3 段等待。
  - 不会把残句写入数据；代价是该篇本轮缺失。

#### B3. 调用点切换

- 位置：`L607`
- 类型：修改（原行保留为注释）
- 改动：

```diff
-          const summary = await generateSummary(post.text, model);
+          // 原实现（已注释保留，见 L596）
+          // const summary = await generateSummary(post.text, model);
+          // const summary = await generateSummaryWithRetry(post.text, model);   // L602，上一版
+          const summary = await generateSummaryChecked(post.text, model);
```

- 作用：把「限流重试」和「内容校验」串起来。
- 后果：所有生成路径都会经过内容校验。

### 3.3 阶段 C：绕开 xsai 的续写缺陷

#### C1. 原因（实测定位）

`@xsai/generate-text 0.4.0-beta.10` 在计算 `stepType` 时，`steps` 还是空数组（`steps.push` 发生在判断之后），因此当响应**缺少 `finish_reason`** 时会被判定为 `continue`：它把上一轮 assistant 消息写回 `messages` 再请求一次，最终只返回「续写出来的那一段」。

- 旧接口实测 5 次请求中有 4 次不返回 `finish_reason`。
- 这解释了「摘要只剩后半句」。
- 续写时若 `content` 为空，接口直接返回 400：日志中的 `'messages[2].content' is required`。

#### C2. `LlmHttpError`

- 位置：`L281-L289`
- 类型：新增
- 作用：直接 `fetch` 失败时保留 HTTP 状态码（`error.response.status`），让 A3 的 `isRetryable` 继续生效。

#### C3. `generateSummaryDirect`

- 位置：`L291-L352`
- 类型：新增
- 作用：单次请求、单次解析，不做任何续写。
- 影响：
  - 初版指向 `chat/completions`；阶段 E 已改为火山方舟 Responses API。
  - 新增请求超时（初版 `AbortSignal.timeout(120_000)`，13:01 调整为 180 秒），避免服务端挂起时脚本无限卡住。
  - 空正文按「503」抛出，归类为可重试。

#### C4. 重试函数支持注入实现

- 位置：`L363` 签名
- 类型：修改（新增可选参数，默认值不变）
- 代码：

```ts
async function generateSummaryWithRetry(
  text: string,
  model: string,
  generate: (text: string, model: string) => Promise<string> = generateSummary,
): Promise<string>
```

- 作用：`generateSummaryChecked` 传入 `generateSummaryDirect`，从而绕开 xsai；不传第三参数时仍是原来的 xsai 路径。
- 后果：旧实现完整保留，可随时对调。

### 3.4 阶段 D：三段等待可配置

#### D1. 环境变量

- 位置：`L149-L201`
- 类型：新增 / 修改
- 内容：

| 环境变量 | 控制对象 | 默认值 | 是否影响残句等待 |
| --- | --- | --- | --- |
| `SUMMARY_INTERVAL_MS` | 每篇请求前的固定等待 | 1500 | 否 |
| `SUMMARY_RETRY_BASE_MS` | 429/5xx 退避基数（第 n 次 = base × 2^n） | 15000 | 未单独设置时间接影响 |
| `SUMMARY_REGEN_DELAY_MS` | 残句重生成前的等待 | 跟随 `SUMMARY_RETRY_BASE_MS` | 是 |

- 解析规则：未设置、空串、非数字、负数 → 回落默认值；`0` 是合法值，表示不等待。
- 代码：

```ts
function readNonNegativeMs(envName: string): number | null { /* ... */ }

const RETRY_BASE_DELAY_MS = readNonNegativeMs(RETRY_BASE_DELAY_ENV) ?? DEFAULT_RETRY_BASE_DELAY_MS;
const REGEN_DELAY_MS = readNonNegativeMs(REGEN_DELAY_ENV) ?? RETRY_BASE_DELAY_MS;
```

- 后果：切换快接口时可以一键关闭全部等待；不稳定接口仍可保留默认值。

#### D2. 启动日志

- 位置：`L514-L519`
- 类型：新增
- 内容：启动时打印 `Request interval`、`Retry base`、`Regen delay` 三项生效值，便于确认环境变量是否被正确读取。

#### D3. 使用说明

- 位置：文件头 `L11-L16`
- 类型：新增注释
- 新增示例：

```text
SUMMARY_INTERVAL_MS=0 pnpm generate:summaries
SUMMARY_RETRY_BASE_MS=0 SUMMARY_REGEN_DELAY_MS=0 pnpm generate:summaries
```

### 3.5 阶段 E：切换到火山方舟 Responses API

#### E1. 接口与模型常量

- 位置：`L37-L44`
- 类型：修改（替换旧值）

```diff
-// LLM API settings (OpenAI-compatible)
-// Works with: LM Studio, Ollama, OpenAI, etc.
-const API_BASE_URL = 'https://maas-api.unisound.com/v1/';
-const API_KEY = process.env.AI_API_KEY ?? '';
-const DEFAULT_MODEL = 'u2-flash';
+// LLM API settings
+// 当前使用火山方舟 Responses API（/api/v3/responses）……
+const API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/';
+const API_KEY = process.env.AI_API_KEY ?? '';
+const DEFAULT_MODEL = 'doubao-seed-evolving';
+const RESPONSES_URL = `${API_BASE_URL}responses`;
```

- 原因：你的新模型只提供 Responses API（`/api/v3/responses`），与旧的 `chat/completions` 请求/响应结构不同。
- 后果：
  - 默认模型名变化会触发缓存失效（`isCacheValid` 比较 `cache.model`），因此第一次运行会用新模型重生成全部文章。
  - 旧的 xsai 函数 `generateSummary` 仍指向 `chat/completions`，但已不在主路径上调用。

#### E2. 健康检查改为 `/responses`

- 位置：`L229-L250`
- 类型：修改
- 改动：`chat/completions` + `messages` + `max_tokens: 1` → `responses` + `input: 'ping'` + `max_output_tokens: 16` + `thinking: { type: 'disabled' }`，并加了 15 秒超时。
- 后果：启动预检不再 404；如果 key/模型不对，会直接提示「LLM API is not running」。

#### E3. 摘要请求与解析改为 Responses API

- 位置：`L291-L352`
- 类型：修改
- 请求体：

```ts
{
  model,
  instructions: '你是一个文章总结助手……',
  input: [
    { role: 'user', content: [{ type: 'input_text', text: `请总结以下文章：\n\n${truncatedText}` }] },
  ],
  temperature: 0.3,
  max_output_tokens: 3000,
  thinking: { type: 'enabled' },
  reasoning: { effort: 'high' },
}
```

- 响应解析：

```ts
if (data.status && data.status !== 'completed') {
  throw new LlmHttpError(503, `incomplete response (status: ${data.status})`);
}

const summary = (data.output ?? [])
  .filter((item) => item.type === 'message')
  .flatMap((item) => item.content ?? [])
  .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
  .map((part) => part.text as string)
  .join('')
  .trim();
```

- **思考与额度的关系（最终结论）**：不是不能开思考，而是思考会占用 `max_output_tokens`。实测 `effort: high` 每篇用掉约 600-920 个 `reasoning_tokens`，若上限只有 400，额度会被思考吃光，返回 `status: incomplete` 且正文为空。
  - 最终配置：`max_output_tokens: 3000` + `thinking: { type: 'enabled' }` + `reasoning: { effort: 'high' }`
  - 实测单篇 16-37 秒，正文 124-207 字，reasoning 600-920 tokens，`status` 均为 `completed`
  - 质量对比：开启思考后的摘要更具体（能写出 `dup2`、`2>&1` 顺序、`pipefail`、浮士德两部结构等细节），关闭思考时更概括
- 其他后果：
  - 输出上限从旧的 `max_tokens: 200` 提到 `max_output_tokens: 3000`，为思考与正文都留出空间。
  - `status !== completed` 或空正文都按 503 可重试，避免写入半截摘要。
  - 健康检查（`checkApiRunning`）仍然关闭思考，因为它只是 `ping` 连通性检查，不需要推理。
  - 超时设为 180 秒（初版 120 秒），防止挂起。

### 3.6 被删除的 8 行原代码（逐行）

| # | 被删除的行 | 处理方式 |
| --- | --- | --- |
| 1 | `// LLM API settings (OpenAI-compatible)` | 由新注释替代 |
| 2 | `// Works with: LM Studio, Ollama, OpenAI, etc.` | 由新注释替代 |
| 3 | `const API_BASE_URL = 'https://maas-api.unisound.com/v1/';` | 改为火山方舟地址 |
| 4 | `const DEFAULT_MODEL = 'u2-flash';` | 改为 `doubao-seed-evolving` |
| 5 | `const response = await fetch(\`${API_BASE_URL}chat/completions\`, {` | 健康检查改为 `${RESPONSES_URL}` |
| 6 | `messages: [{ role: 'user', content: 'ping' }],` | 改为 `input: 'ping'` |
| 7 | `max_tokens: 1,` | 改为 `max_output_tokens: 16` |
| 8 | `const summary = await generateSummary(post.text, model);` | 原行在 `L596` 以注释保留，当前调用为 `generateSummaryChecked` |

其中第 8 行是第一阶段唯一被删除的原项目代码；按你的要求，原行已在原位置注释保留，且 `generateSummary` 函数本体未被删除。

### 3.7 被保留的旧实现（未删除）

- `generateSummary`（xsai 版，`L251-L277`）：保留，仍可作为 OpenAI 兼容接口的回退路径。
- `generateSummaryWithRetry` 默认调用旧实现；只有显式传入 `generateSummaryDirect` 时才走直连。
- 两处历史调用行均以注释保留：
  - `L596`：`// const summary = await generateSummary(post.text, model);`
  - `L602`：`// const summary = await generateSummaryWithRetry(text, model);`

---

## 4. 数据文件改动

### 4.1 `src/assets/summaries.json`

- Git：`M`，**+306 / -6**
- 时间：2026-10-21 11:20:36
- 内容变化：
  - 改动前：**5 条**摘要（`shuangta-park`、`jinzhong-institute-review`、`diary-2026-10-18`、`beiqi-mural-museum`、`fitness-basics`）
  - 过程中：扩展到 **80 条**（旧模型 `u2-flash`）
  - 最终：**80 条**全部由新模型 `doubao-seed-evolving` 重新生成
- 结构不变：

```json
{
  "<slug>": { "title": "…", "summary": "…" }
}
```

- 最终统计（思考模式 `effort: high`）：
  - 条目 80，空标题/空摘要 0
  - 摘要长度：最短 97 字、平均 196 字、最长 318 字
  - 残句（按 3.2 规则）：0
- 后果：页面展示的摘要整体换成了新模型的风格与内容；需要重新构建才会进入静态页面。

### 4.2 `.cache/summaries-cache.json`

- Git：忽略
- 时间：2026-10-21 11:20:36
- 内容变化：
  - `entries`：5 → 80
  - `model`：`u2-flash` → `doubao-seed-evolving`
  - `version` 仍为 `1`
- 作用：增量生成的依据；`hash` 与文章内容绑定，内容没变就复用。
- 后果：
  - 下次运行只处理新增或修改过的文章。
  - 删除某条即可单独重生成该篇。
  - 修改 `--model` 会因 `model` 字段不一致导致整份缓存失效、全量重算。

### 4.3 `.env`

- Git：忽略（`.gitignore:18`）
- 时间：2026-10-21 10:48:37
- 变化：`AI_API_KEY` 的值替换为火山方舟的新 key（**具体值不在本文记录，避免二次泄露**）
- 后果：脚本通过 `node --env-file-if-exists=.env` 读取；仓库提交不受影响。

### 4.4 备份与临时文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `.cache/summaries-cache.u2-flash.json` | 保留 | 旧接口 `u2-flash` 的 80 条摘要缓存，可用于回滚 |
| `.cache/summaries-cache.doubao-disabled.json` | 保留 | 新模型「关闭思考」版本的 80 条摘要缓存，可用于对比或回滚 |
| `.cache/summaries.u2-flash.json` | 已删除 | 旧输出文件的临时备份，回滚时可从上面的缓存重建 |
| `.tmp-summaries.log` | 已删除 | 运行监控日志，每次运行后清理 |

---

## 5. 运行记录（今天实际执行过的）

| # | 场景 | 耗时 | 结果 |
| --- | --- | --- | --- |
| 0 | 你在改动前自行运行 | 200.2s | 44 生成成功 / 33 个 429 / 输出 49 条 |
| 1 | 加入节流与退避后首次全量 | 310.7s | `Cached: 47, Generated: 33, Errors: 0` |
| 2 | 清理 20 条残句后重跑 | 424.9s | 输出 79 条，1 个错误（`reading-20-faust` 连续残句） |
| 3 | 加严校验后重跑 18 条 | 1899.8s | 输出 76 条，4 个错误（含 xsai 的 400：`messages[2].content is required`） |
| 4 | 直连实现补齐 | 219.4s | `Cached: 76, Generated: 4, Errors: 0`，输出 80 条 |
| 5 | 新模型试跑 3 篇 | 16.5s | `Cached: 77, Generated: 3, Errors: 0` |
| 6 | 新模型全量重生成（关闭思考） | 448.2s | 输出 80 条，**0 错误、0 次残句重生成** |
| 7 | 思考模式（`effort: high`）全量重跑 | 2468.0s | `Cached: 0, Generated: 79, Errors: 1`（`reading-23-odyssey` 120 秒超时） |
| 8 | 补齐超时篇目 | 29.8s | `Cached: 79, Generated: 1, Errors: 0`，输出 **80/80** |

说明：

- 第 1 次是验证「节流是否解决 429」；结果 0 次 429。
- 第 2、3 次暴露出「半句摘要」是接口/xsai 行为，不是节流造成。
- 第 4 次引入直连后补齐成功。
- 第 6 次是当前最终状态。

---

## 6. 验证与验收

### 6.1 静态检查

```bash
pnpm exec biome check src/scripts/generateSummaries.ts   # 通过，无修复
pnpm check                                               # 0 errors / 0 warnings / 2 hints
```

2 条 hints 为仓库既有的 `execCommand` 弃用提示，与本次改动无关。

### 6.2 数据校验

```bash
node -e "console.log(Object.keys(require('./src/assets/summaries.json')).length)"
# 80
```

- 条目数：80 / 80
- 缓存条目：80，`model = doubao-seed-evolving`
- 残句：0
- 空字段：0
- 长度区间：97 - 318（平均 196）
- 生成方式：开启思考，`reasoning.effort = high`

### 6.3 抽样结果

- `shuangta-park`：完整介绍双塔、永祚寺、明代牡丹与游览信息
- `nanzhai-park`：完整介绍雪后南寨公园、苗圃历史与冬季景致
- `binhe-greenway-rides`：完整概括三次骑行 172.5 公里与绿道概况
- `linux-06-pipes-and-redirection`：完整概括重定向/管道原理与常见陷阱

---

## 7. 影响、风险与回滚

### 7.1 行为影响

1. **更慢但更稳**：默认每次请求前等 1.5 秒；限流时最多按 15/30/60/120/240 秒退避，单篇最坏约 7.5 分钟。
2. **不再产生半句摘要**：校验命中就重新生成；仍不合格则不写入，宁缺毋滥。
3. **失败可自愈**：失败文章不写缓存，下次运行只补缺口。
4. **切换模型会全量重算**：缓存按模型名失效，这是预期行为。
5. **摘要风格整体变化**：80 条摘要已由新模型重写，与旧模型措辞不同。

### 7.2 已知限制

- 残句校验只做结构性检查（非空、不以标点开头、结尾有句末标点、长度阈值）；开头是否完整依赖接口返回 `status === completed`。若接口在 `completed` 状态下仍给出残缺内容，校验不会拦截。
- 开启思考后单篇耗时约 16-37 秒，本次 80 篇全量实际耗时 **2468 秒（约 41 分钟）**；关闭思考时约 3-7 秒一篇。
- 超时已从 120 秒调到 **180 秒**：本次 `reading-23-odyssey` 在 120 秒上限下超时一次，补跑后成功。
- 直连实现要求 Responses API 的返回结构（`output[].content[].output_text`）；换回 OpenAI 兼容接口时需要同步改回 `chat/completions` 的解析。
- `generateSummary`（xsai）已不在主路径，但仍是可用的历史实现。
- 接口 key 已在对话中出现，若日志或仓库可能公开，建议在火山方舟控制台轮换。

### 7.3 回滚方式

```bash
# 1) 恢复旧模型缓存（含旧摘要）
cp .cache/summaries-cache.u2-flash.json .cache/summaries-cache.json

# 2) 如要连代码一起回滚
git checkout -- src/scripts/generateSummaries.ts
```

注意：

- `git checkout --` 会丢弃本次对脚本的全部改动，属于破坏性操作。
- 恢复缓存后，仍需把脚本顶部的 `API_BASE_URL` / `DEFAULT_MODEL` 改回旧值，否则模型名不一致会再次触发全量重算。
- 旧输出文件 `summaries.json` 没有单独保留副本，但所有旧摘要仍保存在 `.cache/summaries-cache.u2-flash.json` 的 `entries[*].summary` 中，可写脚本重建。

---

## 8. 未由我改动的文件（避免混淆）

| 文件 | 实际改动者 | 内容 |
| --- | --- | --- |
| `config/site.yaml` | 你 | 友链信息：`爱折腾的设计师` → `分享设计与科技生活`、`张洪 Heo` → `张洪Heo`、`云深不知处` 的 URL 改为 `https://www.lanzlz.cn` |
| `src/assets/similarities.json` | 你（我未执行 `generate:similarities`） | 11:20:45 被重新生成，整文件重写 |
| `src/content/blog/life/*.md`、`src/content/blog/en/life/*.md` | 前一晚（2026-10-20） | 南寨公园、滨河骑行两篇中英文文章，已提交，不属于今天的改动 |

---

## 9. 下一步建议

1. 重新运行 `pnpm generate:similarities`（摘要已全部更新，相似度向量应随之重算）。
2. 运行 `pnpm build` 或重启 dev，让新摘要进入页面。
3. 视需要清理 `generateSummary`（xsai）历史实现与 `.cache/summaries-cache.u2-flash.json` 备份。
