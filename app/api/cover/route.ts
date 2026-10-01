// 封面代理 + 本地缓存
//
// 为什么不让浏览器直接加载源站图片：
//   * 豆瓣的图床对没有 Referer 的请求返回 418（浏览器的 referrer-policy 一变就挂），
//     实测 <img> 直连时有一部分封面加载不出来。
//   * 源站 URL 会失效、会改版。这是要长期留着的家庭书目，封面不该指望别人的 CDN。
// 所以：服务端带齐 Referer/UA 抓一次，压成 webp 落到本地，之后都走本地缓存。
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uploadDir } from "@/app/api/upload/route";
import { fail, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { BlockedAddressError, fetchAllowed } from "@/lib/ssrf";

// 只代理已知图书数据源的图床，避免变成任人使用的开放代理。
//
// 光有白名单不够：白名单只管第一跳，而 fetch 默认跟随跳转。
// 白名单里的域名（googleusercontent.com 上谁都能放东西）302 一下，
// 就能把服务端带去请求 127.0.0.1 上那十几个别的服务。
// 所以抓取走 lib/ssrf.ts 的 fetchAllowed：每一跳都重过白名单 + 解析 IP 查内网段。
const ALLOWED_HOSTS = [
  "doubanio.com",
  "openlibrary.org",
  "covers.openlibrary.org",
  "books.google.com",
  "books.googleusercontent.com",
  "googleusercontent.com",
];

function hostAllowed(hostname: string): boolean {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

function cacheDir(): string {
  return path.join(uploadDir(), "cover-cache");
}

export const GET = route(async (req: Request) => {
  // 抓外网 + 转码 + 落盘，代价不低，不能任人无限刷
  rateLimit(req, "upload");
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return fail("missing_url", 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail("bad_url", 400);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return fail("bad_scheme", 400);
  if (!hostAllowed(target.hostname)) return fail("host_not_allowed", 403);

  const key = createHash("sha256").update(target.toString()).digest("hex").slice(0, 32);
  const file = path.join(cacheDir(), `${key}.webp`);

  const serve = (buf: Buffer) =>
    new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });

  // 命中缓存
  try {
    return serve(await readFile(file));
  } catch {
    // 未缓存，继续往下抓
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetchAllowed(target, (u) => hostAllowed(u.hostname), {
      signal: controller.signal,
      headers: {
        // 豆瓣图床要求带 Referer，否则 418
        Referer: target.hostname.includes("doubanio") ? "https://book.douban.com/" : target.origin,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/jpeg,image/png,*/*",
      },
    });
    if (!res.ok) return fail("upstream_failed", 502, { status: res.status });

    const input = Buffer.from(await res.arrayBuffer());
    const output = await sharp(input)
      .resize({ width: 600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    await mkdir(cacheDir(), { recursive: true });
    await writeFile(file, output);
    return serve(output);
  } catch (err) {
    if (err instanceof BlockedAddressError) return fail("host_not_allowed", 403, { reason: err.reason });
    if (err instanceof Error && err.name === "AbortError") return fail("upstream_timeout", 504);
    return fail("upstream_error", 502);
  } finally {
    clearTimeout(timer);
  }
});
