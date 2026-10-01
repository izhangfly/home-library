// Google Books
//
// ⚠️ 2026-08 实测：不带 key 的匿名调用已经被 Google 把配额降到 0，
//    本机和 Hetzner 都直接返回 429 RESOURCE_EXHAUSTED（quota_limit_value: "0"）。
//    也就是说这个源现在**必须配 API key** 才有用。
//    没配 key 时依然会尝试一次（万一哪天放开了），但 429 会被当成
//    "源不可用" 而不是 "查无此书"，前端会明确告诉你差一个 key。
import { request as httpsRequest } from "node:https";
import {
  ProviderError,
  type BookCandidate,
  type MetadataProvider,
} from "./types";

/**
 * 强制走 IPv4 取 JSON。
 *
 * 为什么不用普通 fetch：Hetzner 这台机器同时有 v4 和 v6 出口，Node 的
 * Happy Eyeballs 经常挑 IPv6（YOUR_SERVER_IPV6）。而 Google API key
 * 上的 IP 白名单填的是 IPv4，于是服务端调用一律 403 API_KEY_IP_ADDRESS_BLOCKED
 * ——本地开发却是好的，最难查的那种问题。
 * dns.setDefaultResultOrder("ipv4first") 实测不可靠，所以直接在 socket 层钉死 family: 4。
 * 就算以后把 IPv6 也加进白名单，这里依然能正常工作。
 */
function getJsonViaIpv4(url: string, timeoutMs = 9000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { family: 4, timeout: timeoutMs, headers: { Accept: "application/json" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new ProviderError(`timeout_after_${timeoutMs}ms`));
    });
    req.on("error", (err) => reject(new ProviderError(err.message)));
    req.end();
  });
}

interface GbVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  pageCount?: number;
  printType?: string;
  categories?: string[];
  language?: string;
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  industryIdentifiers?: { type?: string; identifier?: string }[];
  infoLink?: string;
}

function mapVolume(v: GbVolumeInfo): BookCandidate | null {
  if (!v.title) return null;
  const ids = v.industryIdentifiers ?? [];
  // Google 给的封面是 http + zoom=1 的小图，换成 https 并要大一点的
  const thumb = (v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail)
    ?.replace(/^http:/, "https:")
    .replace(/&edge=curl/, "");

  return {
    source: "googleBooks",
    title: v.title,
    subtitle: v.subtitle,
    authors: v.authors,
    publisher: v.publisher,
    pubDate: v.publishedDate,
    pageCount: v.pageCount,
    language: v.language,
    summary: v.description,
    coverUrl: thumb,
    isbn13: ids.find((i) => i.type === "ISBN_13")?.identifier,
    isbn10: ids.find((i) => i.type === "ISBN_10")?.identifier,
    subjects: v.categories,
    externalUrl: v.infoLink,
  };
}

// 用户明确要求把 key 直接写进项目（该项目不上传 GitHub）。环境变量优先。
const FALLBACK_KEY = "";

async function query(q: string): Promise<BookCandidate[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY || FALLBACK_KEY;
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10` +
    (key ? `&key=${key}` : "");

  const res = await getJsonViaIpv4(url);
  if (res.status === 429) {
    throw new ProviderError(key ? "quota_exceeded" : "needs_api_key");
  }
  if (res.status === 403) {
    // 十有八九是 key 的 IP/来源限制没配对，把原因原样带出去，别让人猜
    const reason = res.body.includes("API_KEY_IP_ADDRESS_BLOCKED")
      ? "key_ip_restricted"
      : "key_forbidden";
    throw new ProviderError(reason);
  }
  if (res.status < 200 || res.status >= 300) throw new ProviderError(`http_${res.status}`);

  const data = JSON.parse(res.body) as { items?: { volumeInfo?: GbVolumeInfo }[] };
  return (data.items ?? [])
    .map((i) => (i.volumeInfo ? mapVolume(i.volumeInfo) : null))
    .filter((c): c is BookCandidate => !!c);
}

export const googleBooksProvider: MetadataProvider = {
  id: "googleBooks",

  isEnabled() {
    return process.env.GOOGLE_BOOKS_ENABLED !== "false";
  },

  async byIsbn(isbn13: string): Promise<BookCandidate[]> {
    const found = await query(`isbn:${isbn13}`);
    return found.map((c) => ({ ...c, isbn13: c.isbn13 ?? isbn13 }));
  },

  search: query,
};
