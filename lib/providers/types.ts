export type ProviderId = "googleBooks" | "openLibrary" | "douban" | "wanzhou";

/** 各源归一化之后的书目候选。字段留空表示该源没给，不要用空字符串占位。 */
export interface BookCandidate {
  source: ProviderId;
  isbn13?: string;
  isbn10?: string;
  title?: string;
  subtitle?: string;
  originalTitle?: string;
  authors?: string[];
  translators?: string[];
  publisher?: string;
  pubDate?: string;
  language?: string;
  pageCount?: number;
  binding?: string;
  price?: string;
  summary?: string;
  coverUrl?: string;
  /** 源站页面，人工核对时直接点过去 */
  externalUrl?: string;
  /** 源给的主题词，用于标签建议(F2) */
  subjects?: string[];
  /** 杜威十进分类号（目前只有 OpenLibrary 会给） */
  ddc?: string;
}

export interface ProviderResult {
  source: ProviderId;
  ok: boolean;
  candidates: BookCandidate[];
  /** 失败原因，会原样展示给用户（"这个源没查到" vs "这个源挂了"是两回事） */
  error?: string;
  ms: number;
}

export interface MetadataProvider {
  id: ProviderId;
  /** 未配置的源直接跳过，不占查询时间 */
  isEnabled(): boolean;
  byIsbn(isbn13: string, isbn10?: string): Promise<BookCandidate[]>;
  search?(query: string): Promise<BookCandidate[]>;
}

export class ProviderError extends Error {}

const DEFAULT_TIMEOUT_MS = 9000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(`timeout_after_${timeoutMs}ms`);
    }
    throw new ProviderError(err instanceof Error ? err.message : "network_error");
  } finally {
    clearTimeout(timer);
  }
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  return undefined;
}

export function toStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    const out = value
      .map((v) => (typeof v === "string" ? v.trim() : firstString(v)))
      .filter((v): v is string => !!v);
    return out.length ? out : undefined;
  }
  return undefined;
}

export function toInt(value: unknown): number | undefined {
  const s = firstString(value);
  if (!s) return undefined;
  const m = s.match(/\d+/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
