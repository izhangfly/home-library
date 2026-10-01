// 多源级联查询与合并 —— F1
//
// 为什么并行而不是严格串行：
//   spec 要求「多源结果冲突时展示给用户选择」，那就必须拿到所有源的结果才能比。
//   所以这里并行发起、按优先级合并 —— 效果等价于级联，但快得多，
//   而且一个源挂了不会拖累其它源。
import { isLikelyChinese } from "../isbn";
import { doubanProvider } from "./douban";
import { googleBooksProvider } from "./googleBooks";
import { openLibraryProvider } from "./openLibrary";
import { wanzhouProvider } from "./wanzhou";
import type { BookCandidate, MetadataProvider, ProviderId, ProviderResult } from "./types";

const ALL: MetadataProvider[] = [
  doubanProvider,
  wanzhouProvider,
  googleBooksProvider,
  openLibraryProvider,
];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  douban: "豆瓣",
  wanzhou: "万舟",
  googleBooks: "Google Books",
  openLibrary: "OpenLibrary",
};

/** 中文书先信中文源，英文书先信英文源 —— 决定合并时谁覆盖谁 */
function priorityOrder(isbn13?: string): ProviderId[] {
  return isLikelyChinese(isbn13)
    ? ["wanzhou", "douban", "googleBooks", "openLibrary"]
    : ["googleBooks", "openLibrary", "douban", "wanzhou"];
}

/**
 * 个别字段不能跟着整体优先级走。
 *
 * 封面：Google Books 免费接口只返回 128px 的 thumbnail。
 * 13 本实测里它给出 5 张封面，**没有一张宽度达到 200px**；
 * 同期豆瓣 13/13 全部可用、平均 514px，OpenLibrary 9/13 可用、平均 292px。
 * 如果封面也按整体优先级来，英文书就会存下 128px 的糊图而丢掉豆瓣的 500px 版本。
 * 所以封面单独排序，Google Books 垫底（有总比没有强）。
 */
const FIELD_PRIORITY: Partial<Record<MergeField, ProviderId[]>> = {
  coverUrl: ["douban", "openLibrary", "wanzhou", "googleBooks"],
};

async function runProvider(
  provider: MetadataProvider,
  fn: (p: MetadataProvider) => Promise<BookCandidate[]>,
): Promise<ProviderResult> {
  const started = Date.now();
  try {
    const candidates = await fn(provider);
    return { source: provider.id, ok: true, candidates, ms: Date.now() - started };
  } catch (err) {
    return {
      source: provider.id,
      ok: false,
      candidates: [],
      error: err instanceof Error ? err.message : "unknown_error",
      ms: Date.now() - started,
    };
  }
}

// ---------------------------------------------------------------- 合并

const MERGE_FIELDS = [
  "title", "subtitle", "originalTitle", "authors", "translators", "publisher",
  "pubDate", "language", "pageCount", "binding", "price", "summary", "coverUrl",
  "isbn10", "subjects", "ddc",
] as const;

type MergeField = (typeof MERGE_FIELDS)[number];

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function normalizeForCompare(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x).trim().toLowerCase()).sort().join("|");
  return String(v).trim().toLowerCase();
}

export interface FieldConflict {
  field: MergeField;
  /** 各源给出的不同取值，按优先级排序，第一个就是当前采用的 */
  options: { source: ProviderId; value: unknown }[];
}

export interface MergedLookup {
  merged: Partial<BookCandidate>;
  /** 每个字段最终采用了哪个源的值 → 存进 Book.sourceMeta */
  sourceMeta: Record<string, ProviderId>;
  /** 有分歧的字段，前端弹出来让用户挑（spec F1 验收条件 2） */
  conflicts: FieldConflict[];
  results: ProviderResult[];
  /** 所有源都没查到 → 前端引导走手动录入 */
  empty: boolean;
}

export function mergeCandidates(
  results: ProviderResult[],
  isbn13?: string,
): MergedLookup {
  const order = priorityOrder(isbn13);
  // 每个源只取它自己最好的那条候选（byIsbn 基本只会返回一条）
  const bySource = new Map<ProviderId, BookCandidate>();
  for (const r of results) {
    if (r.ok && r.candidates.length) bySource.set(r.source, r.candidates[0]);
  }

  const rank = (ids: ProviderId[]) =>
    ids.map((id) => bySource.get(id)).filter((c): c is BookCandidate => !!c);

  const ranked = rank(order);

  const merged: Partial<BookCandidate> = {};
  const sourceMeta: Record<string, ProviderId> = {};
  const conflicts: FieldConflict[] = [];

  for (const field of MERGE_FIELDS) {
    // 封面等字段有自己的优先级，见 FIELD_PRIORITY 的说明
    const candidates = FIELD_PRIORITY[field] ? rank(FIELD_PRIORITY[field]!) : ranked;

    const contributions: { source: ProviderId; value: unknown }[] = [];
    for (const candidate of candidates) {
      const value = candidate[field];
      if (!isEmpty(value)) contributions.push({ source: candidate.source, value });
    }
    if (!contributions.length) continue;

    // 采用优先级最高的源
    (merged as Record<string, unknown>)[field] = contributions[0].value;
    sourceMeta[field] = contributions[0].source;

    // 去重后仍有多个不同取值 → 记成冲突
    const distinct: { source: ProviderId; value: unknown }[] = [];
    const seen = new Set<string>();
    for (const c of contributions) {
      const key = normalizeForCompare(c.value);
      if (!seen.has(key)) {
        seen.add(key);
        distinct.push(c);
      }
    }
    if (distinct.length > 1) conflicts.push({ field, options: distinct });
  }

  if (isbn13) merged.isbn13 = isbn13;

  return { merged, sourceMeta, conflicts, results, empty: ranked.length === 0 };
}

// ---------------------------------------------------------------- 对外入口

export async function lookupByIsbn(isbn13: string, isbn10?: string): Promise<MergedLookup> {
  const enabled = ALL.filter((p) => p.isEnabled());
  const results = await Promise.all(
    enabled.map((p) => runProvider(p, (prov) => prov.byIsbn(isbn13, isbn10))),
  );
  return mergeCandidates(results, isbn13);
}

/** 书名/作者搜索：查不到 ISBN 或没有条码的书（老书、外文书）走这条路 */
export async function searchAllProviders(query: string): Promise<{
  results: ProviderResult[];
  candidates: BookCandidate[];
}> {
  const enabled = ALL.filter((p) => p.isEnabled() && typeof p.search === "function");
  const results = await Promise.all(
    enabled.map((p) => runProvider(p, (prov) => prov.search!(query))),
  );

  // 按优先级把各源结果穿插起来，避免一个源刷屏
  const order = priorityOrder(undefined);
  const buckets = order.map((id) => results.find((r) => r.source === id)?.candidates ?? []);
  const candidates: BookCandidate[] = [];
  for (let i = 0; i < Math.max(...buckets.map((b) => b.length), 0); i++) {
    for (const bucket of buckets) if (bucket[i]) candidates.push(bucket[i]);
  }

  return { results, candidates };
}

export type { BookCandidate, ProviderResult, ProviderId };
