/**
 * 封面地址归一化：
 *   本地上传 (/uploads/...) 直接用；
 *   外站图片一律走 /api/cover 代理（带 Referer 抓取 + 本地缓存，见该路由的说明）。
 */
export function coverSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  return `/api/cover?url=${encodeURIComponent(url)}`;
}
