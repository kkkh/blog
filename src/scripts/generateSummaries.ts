/**
 * Generate AI summaries for blog posts using xsai SDK
 *
 * This script:
 * 1. Reads all markdown files from src/content/blog/
 * 2. Extracts plain text from body using remark
 * 3. Calls LLM API (OpenAI-compatible) to generate summaries
 * 4. Caches results for incremental updates
 * 5. Outputs summaries.json for page display
 *
 * Usage:
 *   pnpm generate:summaries                    # Use default model
 *   pnpm generate:summaries --model qwen2.5:1.5b
 *   pnpm generate:summaries --force            # Regenerate all
 *   SUMMARY_INTERVAL_MS=0 pnpm generate:summaries  # 覆盖请求间隔（毫秒，默认 1500）
 *   SUMMARY_RETRY_BASE_MS=0 SUMMARY_REGEN_DELAY_MS=0 pnpm generate:summaries  # 关闭重试/残句等待
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateText } from '@xsai/generate-text';
import chalk from 'chalk';
import { glob } from 'glob';
import matter from 'gray-matter';
import { remark } from 'remark';
import strip from 'strip-markdown';
import { getNonDefaultLocaleGlobs } from './locale-filter';

// --------- Configuration ---------
const CONTENT_GLOB = 'src/content/blog/**/*.md';
const NON_DEFAULT_LOCALE_GLOBS = getNonDefaultLocaleGlobs();
const CACHE_FILE = '.cache/summaries-cache.json';
const OUTPUT_FILE = 'src/assets/summaries.json';
const CACHE_VERSION = '1';

// LLM API settings
// 当前使用火山方舟 Responses API（/api/v3/responses）；若要换回 OpenAI 兼容的
// chat/completions 接口，需要同时调整 RESPONSES_URL 与 generateSummaryDirect。
const API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/';
const API_KEY = process.env.AI_API_KEY ?? ''; // LM Studio doesn't require a real key
const DEFAULT_MODEL = 'doubao-seed-evolving';
/** 火山方舟使用 Responses API，不走 chat/completions */
const RESPONSES_URL = `${API_BASE_URL}responses`;

// --------- Parse CLI Arguments ---------
function parseArgs(): { model: string; force: boolean } {
  const args = process.argv.slice(2);
  let model = DEFAULT_MODEL;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (args[i] === '--force') {
      force = true;
    }
  }

  return { model, force };
}

// --------- Type Definitions ---------
interface PostData {
  slug: string;
  title: string;
  text: string;
  hash: string;
}

interface CacheEntry {
  hash: string;
  title: string;
  summary: string;
  generatedAt: string;
}

interface SummariesCache {
  version: string;
  model: string;
  entries: Record<string, CacheEntry>;
}

interface SummaryOutput {
  title: string;
  summary: string;
}

// --------- Utility Functions ---------

function computeHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function loadCache(): Promise<SummariesCache | null> {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data) as SummariesCache;
  } catch {
    return null;
  }
}

async function saveCache(cache: SummariesCache): Promise<void> {
  const dir = path.dirname(CACHE_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function isCacheValid(cache: SummariesCache, model: string): boolean {
  return cache.version === CACHE_VERSION && cache.model === model;
}

async function getPlainText(markdown: string): Promise<string> {
  const result = await remark().use(strip).process(markdown);
  return String(result)
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+.*$/gm, '')
    .replace(/^\s*(TLDR|Introduction|Conclusion|Summary|References?|Footnotes?)\s*$/gim, '')
    .replace(/^[A-Z\s]{4,}$/gm, '')
    .replace(/^\|.*\|$/gm, '')
    .replace(/^:::.*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractSlug(filePath: string, link?: string): string {
  if (link) return link.toLowerCase();
  const relativePath = filePath.replace(/^src\/content\/blog\//, '').replace(/\.md$/, '');
  return relativePath.toLowerCase();
}

// --------- LLM API ---------

/**
 * 两次模型请求之间强制等待的毫秒数。
 *
 * 实测不加间隔时，脚本约 200 秒内发出了 77 次请求，其中 33 次被接口以
 * 429 rate_limit_exceeded（rpm error）拒绝；而且一旦触发限流，后续请求会在
 * 同一秒内连续失败。1.5 秒的间隔把瞬时速率压到 40 次/分钟以内，再配合下面的
 * 退避重试，可以让一次运行把剩余文章全部补完。
 *
 * 换到不限流或速度更快的接口时，可用环境变量 SUMMARY_INTERVAL_MS 覆盖，
 * 例如 SUMMARY_INTERVAL_MS=0 pnpm generate:summaries（0 表示不等待）。
 * 非法值（非数字、负数）会自动回落到默认的 1500 毫秒。
 */
const DEFAULT_REQUEST_INTERVAL_MS = 1_500;

/** 覆盖请求间隔的环境变量名 */
const REQUEST_INTERVAL_ENV = 'SUMMARY_INTERVAL_MS';

/** 读取环境变量里的非负毫秒数；未设置、空串或非法值返回 null */
function readNonNegativeMs(envName: string): number | null {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** 读取环境变量里的请求间隔；未设置或非法时返回 null，交由调用方回落默认值 */
function readRequestInterval(): number | null {
  return readNonNegativeMs(REQUEST_INTERVAL_ENV);
}

/** 实际生效的请求间隔（毫秒） */
const REQUEST_INTERVAL_MS = readRequestInterval() ?? DEFAULT_REQUEST_INTERVAL_MS;

/**
 * 429 / 5xx 的最大重试次数。
 * 首次尝试不计入重试，因此单篇最多请求 MAX_RETRIES + 1 = 6 次。
 */
const MAX_RETRIES = 5;

/** 退避等待基数的默认值（毫秒） */
const DEFAULT_RETRY_BASE_DELAY_MS = 15_000;

/** 覆盖退避基数的环境变量名 */
const RETRY_BASE_DELAY_ENV = 'SUMMARY_RETRY_BASE_MS';

/**
 * 退避等待的基数（毫秒）。
 * 第 n 次重试等待 RETRY_BASE_DELAY_MS * 2^n，即 15s、30s、60s、120s、240s。
 * 从 15 秒起步是因为接口的限流窗口是「每分钟」级别，等满一个窗口基本就能恢复。
 * 失败的文章不会写入缓存，所以即使某篇最终仍失败，下次运行也只会补这些缺口，
 * 不会重复消耗已经成功的条目。
 *
 * 可用环境变量 SUMMARY_RETRY_BASE_MS 覆盖；设为 0 则重试之间不等待
 * （适合不限流、可立刻重试的接口）。
 */
const RETRY_BASE_DELAY_MS = readNonNegativeMs(RETRY_BASE_DELAY_ENV) ?? DEFAULT_RETRY_BASE_DELAY_MS;

/** 覆盖残句重生成等待的环境变量名 */
const REGEN_DELAY_ENV = 'SUMMARY_REGEN_DELAY_MS';

/**
 * 摘要被判为残句后、下一次重新生成前的等待（毫秒）。
 * 未单独设置时跟随 RETRY_BASE_DELAY_MS，所以调小退避基数会同时缩短这两段等待。
 */
const REGEN_DELAY_MS = readNonNegativeMs(REGEN_DELAY_ENV) ?? RETRY_BASE_DELAY_MS;

/** setTimeout 的 Promise 包装，供退避重试与请求间隔使用 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 从 xsai 抛出的错误对象中读取 HTTP 状态码。
 *
 * xsai 在响应非 2xx 时抛出的 XSAIError 会把原始 Response 挂在 error.response 上
 * （日志里能看到 response: Response { status: 429, ... }），这里只取 status。
 * 网络中断、超时等没有 response 的错误返回 undefined，由调用方决定如何处理。
 */
function getStatusCode(error: unknown): number | undefined {
  const response = (error as { response?: { status?: number } } | null)?.response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

/**
 * 判断错误是否值得重试。
 * 只重试两类：429（限流，等一会儿通常就能过）和 5xx（服务端临时故障）。
 * 401/403（key 无效）、400（请求格式错误）、404（模型名写错）等重试也没用，
 * 直接抛出，避免无意义的等待。
 */
function isRetryable(error: unknown): boolean {
  const status = getStatusCode(error);
  return status === 429 || (status !== undefined && status >= 500);
}

async function checkApiRunning(): Promise<boolean> {
  try {
    // Responses API 的最小连通性检查：只发一个词，并关闭思考以节省额度
    const response = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        input: 'ping',
        max_output_tokens: 16,
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
async function generateSummary(text: string, model: string): Promise<string> {
  // Truncate text to avoid token limits
  const truncatedText = text.slice(0, 6000);

  const { text: summary } = await generateText({
    apiKey: API_KEY,
    baseURL: API_BASE_URL,
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是一个文章总结助手。请用中文，用 2-3 句话简洁地总结文章的核心内容。只输出总结，不要有任何前缀、解释或思考过程。',
      },
      {
        role: 'user',
        content: `请总结以下文章：\n\n${truncatedText}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 200,
  });

  if (!summary) {
    throw new Error('No summary received from LLM response');
  }
  return summary.trim();
}

/** 直接 fetch 失败时保留 HTTP 状态码，复用已有的 isRetryable 判定 */
class LlmHttpError extends Error {
  readonly response: { status: number };

  constructor(status: number, body: string) {
    super(`LLM request failed: ${status} ${body.slice(0, 200)}`);
    this.name = 'LlmHttpError';
    this.response = { status };
  }
}

/**
 * 直接调用火山方舟 Responses API 生成摘要，绕开 xsai。
 *
 * 与 chat/completions 的差异：
 * - 端点固定为 /api/v3/responses，请求体用 input（内容分片）而不是 messages
 * - system 提示放在顶层 instructions
 * - 思考会占用输出额度，因此 max_output_tokens 提到 3000，并保持 thinking enabled
 * - 返回结构是 output[]，需要挑出 type=message 里的 output_text 片段
 *
 * 仍然不用 xsai 的原因：xsai 0.4.0-beta.10 在响应缺少 finish_reason 时会续写，
 * 且只返回续写出来的后半段（旧接口上产生过半句摘要）；这里单次请求、单次解析。
 * 开启思考（effort: high）后实测单篇约 20-50 秒，reasoning 约 700-920 tokens，
 * 正文 170-270 字，内容比关闭思考时更具体。
 */
async function generateSummaryDirect(text: string, model: string): Promise<string> {
  const truncatedText = text.slice(0, 6000);

  const response = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      instructions:
        '你是一个文章总结助手。请用中文，用 2-3 句话简洁地总结文章的核心内容。只输出总结，不要有任何前缀、解释或思考过程。',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: `请总结以下文章：\n\n${truncatedText}` }],
        },
      ],
      temperature: 0.3,
      // 思考会占用输出额度：实测 high 档约 700-920 个 reasoning tokens，
      // 加上正文 200-300 tokens，2000 够用但 3000 更稳妥，避免长篇被截断。
      max_output_tokens: 3000,
      // 保留思考：这是质量最高的模式；只有额度不足时才会出现正文为空。
      // 预检（checkApiRunning）仍然关闭思考，那只是为了省额度的连通性检查。
      thinking: { type: 'enabled' },
      reasoning: { effort: 'high' },
    }),
    // 思考模式下长文可能跑很久；120 秒曾导致 reading-23-odyssey 超时，调到 180 秒
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new LlmHttpError(response.status, await response.text());
  }

  const data = (await response.json()) as {
    status?: string;
    incomplete_details?: unknown;
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };

  // 响应没跑完（通常是 max_output_tokens 被思考耗尽）时，正文可能缺失或被截断。
  // 这时按 503 处理，交给退避重试，而不是把半截内容写进缓存。
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

  if (!summary) {
    // 没有正文通常是额度被思考吃光或服务端异常；归为可重试的 503
    throw new LlmHttpError(503, `empty output (status: ${data.status ?? 'unknown'})`);
  }
  return summary;
}

/**
 * 在 generateSummary 外面包一层指数退避重试。
 *
 * 循环从 attempt = 0 开始：0 表示首次尝试，1..MAX_RETRIES 表示第几次重试。
 * 等待时间依次为 15s、30s、60s、120s、240s；单篇最坏情况下会等约 7.5 分钟。
 * 只有 isRetryable 为真且次数还没用完才继续等；参数错误、鉴权失败等
 * 不可重试的错误，以及重试耗尽的最后一次失败，都会原样抛出，
 * 交给 main 循环里的 catch 记进 Errors 计数。
 */
async function generateSummaryWithRetry(
  text: string,
  model: string,
  generate: (text: string, model: string) => Promise<string> = generateSummary,
): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 正常路径：一次成功就直接返回，不进入退避逻辑
      // 新增：允许注入其它实现；不传第三个参数时仍走原来的 generateSummary（xsai）
      return await generate(text, model);
    } catch (error) {
      // 不可重试，或已经是最后一次尝试：抛出真实错误，由调用方记录并跳过本篇
      if (!isRetryable(error) || attempt === MAX_RETRIES) throw error;
      const waitMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
      const seconds = Math.round(waitMs / 1000);
      // 把「在等待限流窗口」和「卡死」区分开，避免用户以为进程没反应
      process.stdout.write(`\n  ${chalk.yellow(`Rate limited, waiting ${seconds}s (${attempt + 1}/${MAX_RETRIES})`)}\n`);
      await sleep(waitMs);
    }
  }
  throw new Error('Unreachable: retry loop exhausted');
}

/** 摘要可接受的最短长度 */
const MIN_SUMMARY_LENGTH = 40;

/** 残句的典型特征：以标点或右引号开头，说明前半句丢了 */
const TRUNCATED_SUMMARY_START = /^[，。、；：”’）】》]/;

/**
 * 正常摘要常见的开头，用于判断开头是否被截断。
 * 除「本文/文章/这篇」外，新模型（开启思考）还会用「这是一篇……」起笔，
 * 因此把「这是/本篇/该篇/全书/该书」一并纳入白名单。
 */
const SUMMARY_OPENERS = /^(本文|文章|这篇|本|该文|作者|记录|讲述|书中|影片|这是|本篇|该篇|全书|该书|《)/;

/** 完整摘要应有的句末标点；缺了它说明结尾也被截断 */
const SUMMARY_END = /[。！？]$/;

/** 残句重新生成的次数上限（不含首次）；日志里显示为 (n/4) */
const SUMMARY_CHECK_MAX_RETRIES = 4;

/**
 * 判断接口返回的是不是半句话。
 *
 * 2026-10-21 全量运行后有 18 条摘要只剩下半句，例如：
 *   linux-06-pipes-and-redirection → "。"
 *   linux-21-scheduled-tasks      → "落 /etc/cron.d/。"
 *   binhe-greenway-rides          → "了多少”才是关键，最终落脚于……"
 * 单独用 fetch / xsai 请求同一篇文章都能拿到完整摘要，接口自己偶尔会丢掉开头，
 * 所以这里做内容侧兜底。命中以下任一条件即视为残句：
 *   1. 为空；
 *   2. 以句读标点或右引号/右括号开头；
 *   3. 长度不足 MIN_SUMMARY_LENGTH，且不以「本文/文章/这篇……」等常见开头起笔。
 *   4. 结尾不是「。！？」等句末标点，说明结尾被截断。
 *
 * 不再要求固定起笔句式：开启思考后模型会用「三月一日作者……」「容器并非虚拟机……」
 * 这类合理开头，白名单会误杀。开头完整性改由 Responses API 的 status 保证——
 * generateSummaryDirect 在 status !== completed 时按 503 重试。
 */
function isTruncatedSummary(summary: string): boolean {
  const text = summary.trim();
  if (!text) return true;
  if (TRUNCATED_SUMMARY_START.test(text)) return true;
  // 旧规则（已停用）：不以常见句式起笔即判残句。
  // 例如 "结尾则靠……作结。""合上时，他不再觉得……""建议先搭时间轴……"
  // 但开启思考后也会出现 "三月一日作者……" 这类合法开头，故注释保留不再启用。
  // if (!SUMMARY_OPENERS.test(text)) return true;
  // 新增：结尾不是句末标点，按「丢了结尾」处理。
  // 实测还出现过 "……而与 sudo 无关，需用 `sudo sh -c`" 这类被截断的结果。
  if (!SUMMARY_END.test(text)) return true;
  return text.length < MIN_SUMMARY_LENGTH && !SUMMARY_OPENERS.test(text);
}

/**
 * 在 generateSummaryWithRetry 之上再加一道内容完整性校验。
 *
 * 与限流重试分开的原因：限流是请求根本没成功，最多等 5 次；
 * 这里是请求成功但内容残缺，换一次生成通常就能拿到完整结果。
 * 每次重新生成仍走 generateSummaryWithRetry，所以 429 退避依旧生效。
 * 连续 SUMMARY_CHECK_MAX_RETRIES 次仍是残句时抛出错误，交由 main 记为 Errors，
 * 不把半句话写进缓存和 summaries.json。
 */
async function generateSummaryChecked(text: string, model: string): Promise<string> {
  for (let attempt = 0; attempt <= SUMMARY_CHECK_MAX_RETRIES; attempt++) {
    // 上一版：走 xsai；实测接口常缺 finish_reason，xsai 会续写并只返回后半段
    // const summary = await generateSummaryWithRetry(text, model);
    //
    // 现实现：注入 generateSummaryDirect，单次请求只取一条完整回复
    const summary = await generateSummaryWithRetry(text, model, generateSummaryDirect);
    if (!isTruncatedSummary(summary)) return summary;
    // 新增：最后一次已是残句时不再等待，直接跳出并抛出
    if (attempt === SUMMARY_CHECK_MAX_RETRIES) break;
    const label = `Truncated summary, regenerating (${attempt + 1}/${SUMMARY_CHECK_MAX_RETRIES})`;
    process.stdout.write(`\n  ${chalk.yellow(label)}\n`);
    // 残句等待独立成 REGEN_DELAY_MS：默认跟随退避基数，也可用 SUMMARY_REGEN_DELAY_MS 单独覆盖
    await sleep(REGEN_DELAY_MS);
  }
  throw new Error('Summary still truncated after retries');
}

// --------- File Processing ---------

async function processFile(filePath: string): Promise<PostData | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data: frontmatter, content: body } = matter(content);

    if (frontmatter.draft) return null;

    if (!frontmatter.title) {
      console.log(chalk.yellow(`  Skipping ${filePath}: no title`));
      return null;
    }

    // Skip posts with excludeFromSummary: true in frontmatter
    if (frontmatter.excludeFromSummary === true) {
      return null;
    }

    const slug = extractSlug(filePath, frontmatter.link as string | undefined);

    const plainText = await getPlainText(body);
    const hash = computeHash(content);

    return {
      slug,
      title: frontmatter.title as string,
      text: plainText,
      hash,
    };
  } catch (error) {
    console.error(chalk.red(`  Error processing ${filePath}:`), error);
    return null;
  }
}

async function loadPosts(files: string[]): Promise<PostData[]> {
  console.log(chalk.blue('Processing markdown files...'));
  const posts: PostData[] = [];
  for (let i = 0; i < files.length; i++) {
    process.stdout.write(`\r  Processing ${i + 1}/${files.length}...`);
    const post = await processFile(files[i]);
    if (post) posts.push(post);
  }
  console.log('');
  return posts;
}

// --------- Main Execution ---------

async function main() {
  const startTime = Date.now();
  const { model, force } = parseArgs();

  try {
    console.log(chalk.cyan('=== AI Summary Generator ===\n'));
    console.log(chalk.gray(`Model: ${model}`));
    // 打印生效的间隔，便于确认 SUMMARY_INTERVAL_MS 是否被正确读取
    console.log(chalk.gray(`Request interval: ${REQUEST_INTERVAL_MS}ms (${REQUEST_INTERVAL_ENV})`));
    // 429/5xx 的退避基线与残句重生成等待，分别对应两个环境变量
    console.log(
      chalk.gray(
        `Retry base: ${RETRY_BASE_DELAY_MS}ms (${RETRY_BASE_DELAY_ENV}) | Regen delay: ${REGEN_DELAY_MS}ms (${REGEN_DELAY_ENV})`,
      ),
    );
    if (force) {
      console.log(chalk.yellow('Force regenerate: ignoring cache'));
    }
    console.log('');

    // Check LLM API is running
    console.log(chalk.blue(`Checking API connection (${API_BASE_URL})...`));
    const apiRunning = await checkApiRunning();
    if (!apiRunning) {
      console.log(chalk.red('Error: LLM API is not running.'));
      console.log(chalk.gray('Please start your LLM server (LM Studio, Ollama, etc.)'));
      process.exitCode = 1;
      return;
    }
    console.log(chalk.green('API connected!\n'));

    // Load cache
    let cache = force ? null : await loadCache();
    if (cache) {
      if (isCacheValid(cache, model)) {
        console.log(chalk.gray(`Loaded cache with ${Object.keys(cache.entries).length} entries\n`));
      } else {
        console.log(chalk.yellow('Cache invalidated (model changed), will regenerate all\n'));
        cache = null;
      }
    } else if (!force) {
      console.log(chalk.gray('No cache found, will generate all summaries\n'));
    }

    // Find all markdown files
    const files = await glob(CONTENT_GLOB, { ignore: NON_DEFAULT_LOCALE_GLOBS });
    if (!files.length) {
      console.log(chalk.yellow('No content files found.'));
      return;
    }
    console.log(chalk.blue(`Found ${files.length} markdown files\n`));

    // Process all files
    const posts = await loadPosts(files);
    if (!posts.length) {
      console.log(chalk.red('No valid posts found.'));
      return;
    }
    console.log(chalk.green(`Loaded ${posts.length} posts\n`));

    // Generate summaries incrementally
    const validCache = cache?.entries || {};
    const newEntries: Record<string, CacheEntry> = {};
    let cached = 0;
    let generated = 0;
    let errors = 0;

    console.log(chalk.blue('Generating summaries...'));

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const cachedEntry = validCache[post.slug];

      if (cachedEntry && cachedEntry.hash === post.hash) {
        // Use cached summary
        newEntries[post.slug] = cachedEntry;
        cached++;
        process.stdout.write(`\r  [${i + 1}/${posts.length}] ${chalk.gray('cached')}: ${post.slug.slice(0, 40)}...`);
      } else {
        // Generate new summary
        process.stdout.write(`\r  [${i + 1}/${posts.length}] ${chalk.yellow('generating')}: ${post.slug.slice(0, 40)}...`);

        // 只在真正要调用模型时才等待；命中缓存的分支不走这里，所以增量运行时
        // 已完成的文章不会被这 1.5 秒拖慢。目的是把请求速率压到接口的 rpm 限制以下。
        await sleep(REQUEST_INTERVAL_MS);

        try {
          // 原实现：直接调用，不做任何重试。
          // 2026-10-21 首次全量运行时，33 篇因 429 rate_limit_exceeded (rpm error) 失败，
          // 所以改为下面的 generateSummaryWithRetry；原行保留在此便于对照和回退。
          // const summary = await generateSummary(post.text, model);
          //
          // 现实现：失败时按 15s→30s→60s→120s→240s 退避重试，最多 5 次；
          // 只有不可重试的错误或重试耗尽才会落到外层 catch，计入 Errors。
          // 上一版实现：只做 429 退避重试，不校验返回内容。
          // 保留在此便于对照和回退，当前调用见下方 generateSummaryChecked。
          // const summary = await generateSummaryWithRetry(post.text, model);
          //
          // 现实现：在限流重试之外再加上残句校验（见 generateSummaryChecked）。
          // 接口偶发只返回后半句话时会被判为残句并重新生成，仍不行则记入 Errors，
          // 不会把半句话写进缓存和 summaries.json。
          const summary = await generateSummaryChecked(post.text, model);
          newEntries[post.slug] = {
            hash: post.hash,
            title: post.title,
            summary,
            generatedAt: new Date().toISOString(),
          };
          generated++;
        } catch (error) {
          console.log('');
          console.error(chalk.red(`  Error generating summary for ${post.slug}:`), error);
          errors++;
          // Keep old cached entry if available
          if (cachedEntry) {
            newEntries[post.slug] = cachedEntry;
          }
        }
      }
    }

    console.log('');
    console.log(chalk.green(`  Cached: ${cached}, Generated: ${generated}, Errors: ${errors}`));

    // Save cache
    const newCache: SummariesCache = {
      version: CACHE_VERSION,
      model,
      entries: newEntries,
    };
    await saveCache(newCache);
    console.log(chalk.gray(`\nCache saved to: ${CACHE_FILE}`));

    // Generate output file for page display
    const output: Record<string, SummaryOutput> = {};
    for (const [slug, entry] of Object.entries(newEntries)) {
      output[slug] = {
        title: entry.title,
        summary: entry.summary,
      };
    }

    const outputDir = path.dirname(OUTPUT_FILE);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(chalk.green(`\nDone! Generated summaries for ${Object.keys(newEntries).length} posts in ${elapsed}s`));
    console.log(chalk.cyan(`Output saved to: ${OUTPUT_FILE}`));
  } catch (error) {
    console.error(chalk.red('\nError:'), error);
    process.exitCode = 1;
  }
}

main();
