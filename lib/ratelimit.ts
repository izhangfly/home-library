// 限流 —— 保护"花钱的"和"写盘的"接口
//
// 为什么不是加密码：权限只有两级是**故意**的（见 lib/auth.ts）——
// 加书、上架、拍封面谁都能干，妹妹拿手机扫码不该被密码拦住。
// 但站点挂在公网上，几个接口的代价并不对称：
//
//   /api/books/*/ai-summary|clc|ddc  → 调 DeepSeek，花的是真钱
//   /api/lookup                       → 调豆瓣 / Google Books，吃的是第三方配额
//   /api/upload                       → 往磁盘写文件
//   /api/shelving/reflow  (POST)      → 一次搬动全库
//
// 陌生人挂个循环跑一夜，就能把 API 额度烧光、把盘写满。
// 所以对这几个接口按 IP 限流：家里人正常用完全够（一小时扫几百本没问题），
// 匿名脚本跑不动。
//
// 单进程 Next 服务，内存里存就够了，不引依赖也不额外起 Redis。

const WINDOW_MS = 60 * 60 * 1000; // 1 小时滑动窗口

/** 每个桶的配额。定得比"家里最狠的用法"还宽一档 —— 目的是挡脚本，不是挡人。 */
export const LIMITS = {
  /** 调模型的，花钱 */
  llm: 200,
  /** 查书目，走第三方 API。整屋整理一轮要扫几百本，所以给得很宽 */
  lookup: 600,
  /** 上传封面，写盘 */
  upload: 120,
  /** 整屋搬动，一次改一大片数据 */
  bulk: 30,
  /**
   * 猜密码。**只统计失败的那些**（见 rateLimitFailure）。
   *
   * 站点挂在公网上，管理员只有一个共享口令，而登录接口以前一道限流都没有 ——
   * 实测能以约 1 次/秒不停试，一天八万多次，没有锁定、没有日志、没人会知道。
   * 常数时间比较挡的是计时攻击，挡不住"一直猜"。
   *
   * 20 次是给家里人留的余量：一小时内输错二十次已经远超正常手误，
   * 而对攻击者来说，一小时 20 次意味着字典攻击彻底不成立。
   * 成功登录不计数 —— 否则正常用着用着就把自己锁了。
   */
  auth: 20,
} as const;

export type Bucket = keyof typeof LIMITS;

/** key → 该窗口内的请求时间戳 */
const hits = new Map<string, number[]>();

export class RateLimitError extends Error {
  constructor(readonly bucket: Bucket, readonly retryAfterSec: number) {
    super("rate_limited");
  }
}

/**
 * 取客户端 IP。站点在 Caddy 后面，真实 IP 在 X-Forwarded-For 的第一段。
 * 取不到就退回一个固定键 —— 宁可把这些请求算作同一个来源，也不要放开限流。
 */
function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimit(req: Request, bucket: Bucket): void {
  const limit = LIMITS[bucket];
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();

  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= limit) {
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    hits.set(key, recent);
    throw new RateLimitError(bucket, retryAfterSec);
  }

  recent.push(now);
  hits.set(key, recent);

  // 顺手清理：不清的话每个来过的 IP 都会在内存里留一条，永远不掉
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      const live = v.filter((t) => now - t < WINDOW_MS);
      if (live.length) hits.set(k, live);
      else hits.delete(k);
    }
  }
}

/**
 * 事后记一次失败。
 *
 * 和 rateLimit() 的区别：那个是"进门先划一刀"，适合按调用次数计费的接口；
 * 密码这里必须**只记失败**，成功登录不能占额度，否则家里人正常登录几次
 * 就把自己挡在门外了。所以拆成两步：进门先 rateLimit 检查额度（不计数），
 * 验完密码错了才回来记一笔。
 */
export function rateLimitFailure(req: Request, bucket: Bucket): void {
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
}

/** 只看额度够不够，不计数。配合 rateLimitFailure 用。 */
export function rateLimitCheck(req: Request, bucket: Bucket): void {
  const limit = LIMITS[bucket];
  const now = Date.now();
  const recent = (hits.get(`${bucket}:${clientKey(req)}`) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    throw new RateLimitError(bucket, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000));
  }
}

/** 这个窗口内某个桶累计了多少次（给运维告警用） */
export function rateLimitCount(bucket: Bucket): number {
  const now = Date.now();
  let n = 0;
  for (const [k, v] of hits) {
    if (k.startsWith(`${bucket}:`)) n += v.filter((t) => now - t < WINDOW_MS).length;
  }
  return n;
}

/** 仅供测试用：清空计数 */
export function __resetRateLimit(): void {
  hits.clear();
}
