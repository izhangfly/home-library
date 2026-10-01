// 中文首选源 —— 豆瓣移动端 rexxar 接口
//
// 关于选型（对 spec §3.3 的修正，实测得出）：
//   * wanzhou 需要先把 OpenLibrary 全量 dump 拉下来离线建库，服务器只剩 16G 空间，
//     成本远高于收益；仍保留为可选源（配 WANZHOU_BASE_URL 即启用）。
//   * douban-api-rs 已归档两年，而它做的事就是转发豆瓣页面。既然如此，
//     不如直接调豆瓣自己的 JSON 接口 —— 少一个服务、少一层解析、结构化程度还更高。
//
// 实测（2026-08，Hetzner 出口）：带 Referer 头请求即返回完整 JSON，
// 含 title/subtitle/author/translator/press/pubdate/pages/price/intro/cover_url。
// 不带 Referer 会 400。
import {
  fetchWithTimeout,
  firstString,
  toInt,
  toStringArray,
  ProviderError,
  type BookCandidate,
  type MetadataProvider,
} from "./types";

const BASE = "https://m.douban.com/rexxar/api/v2";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function headers(): HeadersInit {
  return {
    "User-Agent": UA,
    Referer: "https://m.douban.com/book/",
    Accept: "application/json, text/plain, */*",
  };
}

interface DoubanSubject {
  id?: string;
  title?: string;
  subtitle?: unknown;
  book_subtitle?: unknown;
  author?: unknown;
  translator?: unknown;
  press?: unknown;
  pubdate?: unknown;
  pages?: unknown;
  price?: unknown;
  intro?: unknown;
  cover_url?: unknown;
  pic?: { large?: string; normal?: string };
  url?: string;
  binding?: unknown;
}

function mapSubject(d: DoubanSubject, isbn13?: string): BookCandidate | null {
  const title = firstString(d.title);
  if (!title) return null;

  // 豆瓣简介里会把「最」等字替换成 *，还常带一堆空行
  const rawIntro = firstString(d.intro);
  const summary = rawIntro
    ? rawIntro.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim()
    : undefined;

  return {
    source: "douban",
    isbn13,
    title,
    subtitle: firstString(d.book_subtitle) ?? firstString(d.subtitle),
    authors: toStringArray(d.author),
    translators: toStringArray(d.translator),
    publisher: firstString(d.press),
    pubDate: firstString(d.pubdate),
    pageCount: toInt(d.pages),
    price: firstString(d.price),
    binding: firstString(d.binding),
    language: "zh",
    summary,
    coverUrl: firstString(d.cover_url) ?? d.pic?.large ?? d.pic?.normal,
    externalUrl: d.url ?? (d.id ? `https://book.douban.com/subject/${d.id}/` : undefined),
  };
}

export const doubanProvider: MetadataProvider = {
  id: "douban",

  isEnabled() {
    return process.env.DOUBAN_ENABLED !== "false";
  },

  async byIsbn(isbn13: string): Promise<BookCandidate[]> {
    const res = await fetchWithTimeout(`${BASE}/book/isbn/${isbn13}`, { headers: headers() });
    if (res.status === 404) return [];
    if (!res.ok) throw new ProviderError(`http_${res.status}`);

    const data = (await res.json()) as DoubanSubject & { msg?: string };
    if (!data || !data.title) return [];
    const candidate = mapSubject(data, isbn13);
    return candidate ? [candidate] : [];
  },

  async search(query: string): Promise<BookCandidate[]> {
    const url = `${BASE}/search/book?q=${encodeURIComponent(query)}&start=0&count=10`;
    const res = await fetchWithTimeout(url, { headers: headers() });
    if (!res.ok) throw new ProviderError(`http_${res.status}`);

    const data = (await res.json()) as {
      items?: { target?: DoubanSubject; target_type?: string }[];
    };
    return (data.items ?? [])
      .filter((i) => !i.target_type || i.target_type === "book")
      .map((i) => (i.target ? mapSubject(i.target) : null))
      .filter((c): c is BookCandidate => !!c);
  },
};
