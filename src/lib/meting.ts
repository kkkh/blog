/**
 * Meting API client — resolves music platform URLs to playable audio streams.
 *
 * Ported from Shoka player.js URL parsing + Meting API integration.
 * Supports NetEase Cloud Music and QQ Music.
 */

const DEFAULT_API = 'https://163.hyc.moe/';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface MetingSong {
  name: string;
  artist: string;
  url: string;
  pic: string;
  lrc: string;
}

interface ParsedUrl {
  server: string;
  type: string;
  id: string;
}

// URL parsing rules (ported from Shoka player.js:30-47)
const URL_RULES: [RegExp, string, string][] = [
  [/music\.163\.com.*song.*id=(\d+)/, 'netease', 'song'],
  [/music\.163\.com.*album.*id=(\d+)/, 'netease', 'albumlist'],
  [/music\.163\.com.*playlist.*id=(\d+)/, 'netease', 'playlist'],
  [/music\.163\.com.*discover\/toplist.*id=(\d+)/, 'netease', 'playlist'],
  [/y\.qq\.com.*song\/(\w+)/, 'tencent', 'song'],
  [/y\.qq\.com.*album\/(\w+)/, 'tencent', 'albumlist'],
  [/y\.qq\.com.*playsquare\/(\w+)/, 'tencent', 'playlist'],
  [/y\.qq\.com.*playlist\/(\w+)/, 'tencent', 'playlist'],
];

/** Parse a music platform URL into server/type/id triple. */
export function parseMusicUrl(url: string): ParsedUrl | null {
  for (const [regex, server, type] of URL_RULES) {
    const match = url.match(regex);
    if (match?.[1]) {
      return { server, type, id: match[1] };
    }
  }
  return null;
}

interface CacheEntry {
  data: MetingSong[];
  timestamp: number;
}

function getCacheKey(server: string, type: string, id: string): string {
  return `meting:${server}:${type}:${id}`;
}

function getFromCache(key: string): MetingSong[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function setCache(key: string, data: MetingSong[]): void {
  try {
    const entry: CacheEntry = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — non-critical, skip silently
  }
}

function isMetingSong(obj: unknown): obj is MetingSong {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.name === 'string' && typeof o.artist === 'string' && typeof o.url === 'string';
}
/**
 * 兼容不同 Meting 实现的字段命名（加法式兼容，不改变原有行为）。
 *
 * 背景：主题默认的 https://163.hyc.moe/ 以及 Meting.php 系实例返回 APlayer 标准字段
 * —— name / artist / url / pic / lrc；
 * 而部分自部署实现（如 xizeyoupan/Meting-API，即这里的 https://music.43322.cn/api ）
 * 返回的是 title / author。
 *
 * 处理规则：
 * - 已经有 name（标准格式）→ 原样返回，走原有流程，行为与改动前完全一致
 * - 只有 title → 补出 name / artist（artist 取 author），其余字段原样保留
 * - 两者都没有 → 原样返回，仍会被后面的 isMetingSong 过滤掉
 */
function withStandardFields(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  const o = obj as Record<string, unknown>;

  // 标准格式：直接放行（默认实例走的就是这条路径，逻辑零变化）
  if (typeof o.name === 'string') return o;
  if (typeof o.title !== 'string') return o;

  // 非标准实现：把 title / author 补齐为 name / artist
  return {
    ...o,
    name: o.title,
    artist: typeof o.author === 'string' ? o.author : '',
  };
}

/** Some HTTPS Meting servers return HTTP links whose redirects fail browser CORS checks. */
function normalizeMediaUrls(songs: MetingSong[], apiUrl: URL): MetingSong[] {
  if (apiUrl.protocol !== 'https:') return songs;

  const normalize = (source: string): string => {
    if (!source?.startsWith('http://')) return source;
    try {
      const url = new URL(source);
      if (url.host !== apiUrl.host) return source;
      url.protocol = 'https:';
      return url.href;
    } catch {
      return source;
    }
  };

  return songs.map((song) => ({
    ...song,
    url: normalize(song.url),
    pic: normalize(song.pic),
    lrc: normalize(song.lrc),
  }));
}

/** Fetch songs from Meting API for a single parsed URL. */
export async function fetchMeting(server: string, type: string, id: string, apiUrl?: string): Promise<MetingSong[]> {
  const url = new URL(apiUrl || DEFAULT_API);
  const cacheKey = getCacheKey(server, type, id);
  const cached = getFromCache(cacheKey);
  if (cached) return normalizeMediaUrls(cached, url);

  const params = new URLSearchParams({ server, type, id });
  url.search = params.toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Meting API error: ${response.status}`);

  const data: unknown = await response.json();
  if (!Array.isArray(data)) return [];
  const songs = normalizeMediaUrls(data.map(withStandardFields).filter(isMetingSong), url);
  if (songs.length > 0) setCache(cacheKey, songs);
  return songs;
}

/** Resolve multiple music URLs into a flat song list. */
export async function resolvePlaylist(urls: string[], apiUrl?: string): Promise<MetingSong[]> {
  const results = await Promise.allSettled(
    urls.map((url) => {
      const parsed = parseMusicUrl(url);
      if (!parsed) return Promise.resolve([]);
      return fetchMeting(parsed.server, parsed.type, parsed.id, apiUrl);
    }),
  );

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
