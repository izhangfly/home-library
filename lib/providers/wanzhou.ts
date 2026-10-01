// wanzhou（万舟）—— 可选的自建中文源，spec §3.3.1
//
// 默认关闭：它要先把 OpenLibrary 全量 dump 拉下来离线建库，服务器空间不够（见 douban.ts 的说明）。
// 哪天你自己部署了一份，把 WANZHOU_BASE_URL 填上就自动接入，不用改代码。
//
// 因为该项目没有公开的 API 文档，这里对返回结构做了防御式解析：
// 常见的几种字段命名都试一遍，实在对不上就当查不到，不会让整个查询流程失败。
import {
  fetchWithTimeout,
  firstString,
  toInt,
  toStringArray,
  ProviderError,
  type BookCandidate,
  type MetadataProvider,
} from "./types";

type Loose = Record<string, unknown>;

function pick(obj: Loose, ...keys: string[]): unknown {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

function mapRecord(raw: Loose, isbn13?: string): BookCandidate | null {
  const title = firstString(pick(raw, "title", "name", "book_title"));
  if (!title) return null;

  return {
    source: "wanzhou",
    isbn13: firstString(pick(raw, "isbn13", "isbn_13", "isbn")) ?? isbn13,
    isbn10: firstString(pick(raw, "isbn10", "isbn_10")),
    title,
    subtitle: firstString(pick(raw, "subtitle", "sub_title")),
    originalTitle: firstString(pick(raw, "original_title", "originalTitle")),
    authors: toStringArray(pick(raw, "authors", "author", "creator")),
    translators: toStringArray(pick(raw, "translators", "translator")),
    publisher: firstString(pick(raw, "publisher", "press", "publishers")),
    pubDate: firstString(pick(raw, "pubdate", "publish_date", "pub_date", "publishedDate", "year")),
    pageCount: toInt(pick(raw, "pages", "page_count", "pageCount", "number_of_pages")),
    price: firstString(pick(raw, "price")),
    binding: firstString(pick(raw, "binding")),
    language: firstString(pick(raw, "language", "lang")) ?? "zh",
    summary: firstString(pick(raw, "summary", "intro", "description", "abstract")),
    coverUrl: firstString(pick(raw, "cover_url", "coverUrl", "cover", "image")),
    subjects: toStringArray(pick(raw, "subjects", "topics", "tags")),
  };
}

/** 返回体可能是单条对象、数组，或 {results:[...]} / {items:[...]} / {data:[...]} */
function extractRecords(payload: unknown): Loose[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as Loose[];
  const obj = payload as Loose;
  for (const key of ["results", "items", "data", "books", "docs"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as Loose[];
  }
  return obj.title || obj.name ? [obj] : [];
}

function base(): string | undefined {
  return process.env.WANZHOU_BASE_URL?.replace(/\/+$/, "") || undefined;
}

export const wanzhouProvider: MetadataProvider = {
  id: "wanzhou",

  isEnabled() {
    return !!base();
  },

  async byIsbn(isbn13: string): Promise<BookCandidate[]> {
    const root = base();
    if (!root) return [];

    // 路径也不确定，按可能性从高到低试；404 继续试下一个
    const paths = [`/isbn/${isbn13}`, `/book/isbn/${isbn13}`, `/api/isbn/${isbn13}`,
                   `/search?q=${isbn13}`, `/api/search?q=${isbn13}`];
    let lastStatus = 0;

    for (const path of paths) {
      const res = await fetchWithTimeout(root + path);
      if (res.status === 404) { lastStatus = 404; continue; }
      if (!res.ok) { lastStatus = res.status; continue; }
      const records = extractRecords(await res.json());
      const mapped = records
        .map((r) => mapRecord(r, isbn13))
        .filter((c): c is BookCandidate => !!c);
      if (mapped.length) return mapped;
    }

    if (lastStatus && lastStatus !== 404) throw new ProviderError(`http_${lastStatus}`);
    return [];
  },

  async search(q: string): Promise<BookCandidate[]> {
    const root = base();
    if (!root) return [];
    const res = await fetchWithTimeout(`${root}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new ProviderError(`http_${res.status}`);
    return extractRecords(await res.json())
      .map((r) => mapRecord(r))
      .filter((c): c is BookCandidate => !!c);
  },
};
