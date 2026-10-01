// 限流的行为测试 —— 见 lib/ratelimit.ts
//
// 要守住两件事，方向相反：
//   1. 家里人正常用**绝不能**被拦（整屋整理一轮要扫几百本）
//   2. 匿名脚本挂一夜**必须**被拦（不然 DeepSeek 的钱和磁盘都保不住）
// 只测其中一件都会得到一个看起来能过、实际没用的限流。
//
// 跑法：npm run verify:ratelimit

import { rateLimit, rateLimitCheck, rateLimitFailure, RateLimitError, LIMITS, __resetRateLimit } from "../lib/ratelimit";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
}

const reqFrom = (ip: string) =>
  new Request("https://example.test/api/x", { headers: { "x-forwarded-for": ip } });

/** 连打 n 次，返回第几次被拦（没被拦返回 -1） */
function hammer(ip: string, bucket: Parameters<typeof rateLimit>[1], n: number): number {
  for (let i = 0; i < n; i++) {
    try { rateLimit(reqFrom(ip), bucket); }
    catch (e) { if (e instanceof RateLimitError) return i; throw e; }
  }
  return -1;
}

console.log("\n=== 限流行为 ===\n");

console.log("A 家里人正常用不该被拦");
__resetRateLimit();
check(`一小时扫 300 本书（lookup 上限 ${LIMITS.lookup}）不被拦`,
  hammer("10.0.0.1", "lookup", 300) === -1);
__resetRateLimit();
check(`其中 150 本要走模型（llm 上限 ${LIMITS.llm}）不被拦`,
  hammer("10.0.0.1", "llm", 150) === -1);
__resetRateLimit();
check(`手动补 50 张封面（upload 上限 ${LIMITS.upload}）不被拦`,
  hammer("10.0.0.1", "upload", 50) === -1);

console.log("\nB 匿名脚本必须被拦");
__resetRateLimit();
const at = hammer("203.0.113.9", "llm", LIMITS.llm + 50);
check(`llm 打到第 ${LIMITS.llm} 次就被拦`, at === LIMITS.llm, `实际第 ${at} 次`);
__resetRateLimit();
check("upload 超额被拦", hammer("203.0.113.9", "upload", LIMITS.upload + 10) === LIMITS.upload);
__resetRateLimit();
check("bulk（整屋搬动）超额被拦", hammer("203.0.113.9", "bulk", LIMITS.bulk + 5) === LIMITS.bulk);

console.log("\nC 各 IP、各桶互不牵连");
__resetRateLimit();
hammer("203.0.113.9", "llm", LIMITS.llm + 5);            // 把这个 IP 打爆
let otherIpOk = true;
try { rateLimit(reqFrom("10.0.0.2"), "llm"); } catch { otherIpOk = false; }
check("一个 IP 被拦，不影响别的 IP", otherIpOk);
let otherBucketOk = true;
try { rateLimit(reqFrom("203.0.113.9"), "lookup"); } catch { otherBucketOk = false; }
check("llm 被拦，不影响同一 IP 的 lookup", otherBucketOk);

console.log("\nD 被拦时要说清楚什么时候能再来");
__resetRateLimit();
hammer("198.51.100.7", "bulk", LIMITS.bulk);
try {
  rateLimit(reqFrom("198.51.100.7"), "bulk");
  check("超额时抛 RateLimitError", false, "没抛");
} catch (e) {
  const err = e as RateLimitError;
  check("超额时抛 RateLimitError", err instanceof RateLimitError);
  check("带上 Retry-After（正数、不超过一小时）",
    err.retryAfterSec > 0 && err.retryAfterSec <= 3600, `${err.retryAfterSec}s`);
  check("带上是哪个桶超了", err.bucket === "bulk", err.bucket);
}

console.log("\nE 拿不到 IP 时要收紧而不是放开");
__resetRateLimit();
const anon = () => new Request("https://example.test/api/x");
let blocked = -1;
for (let i = 0; i < LIMITS.bulk + 5; i++) {
  try { rateLimit(anon(), "bulk"); } catch { blocked = i; break; }
}
check("没有 X-Forwarded-For 的请求归到同一个桶，一样会被拦", blocked === LIMITS.bulk, `第 ${blocked} 次`);

console.log("\nF 猜密码：只记失败，成功不占额度");
__resetRateLimit();
const ip = "203.0.113.99";
// 一头：家里人手误几次不能被挡
for (let i = 0; i < 5; i++) rateLimitFailure(reqFrom(ip), "auth");
let ok5 = true;
try { rateLimitCheck(reqFrom(ip), "auth"); } catch { ok5 = false; }
check("输错 5 次还能继续登（家里人手误）", ok5);

// 成功登录走的是 check 而不是 failure，反复成功不该消耗额度
for (let i = 0; i < 50; i++) rateLimitCheck(reqFrom(ip), "auth");
let stillOk = true;
try { rateLimitCheck(reqFrom(ip), "auth"); } catch { stillOk = false; }
check("成功登录 50 次不占额度（否则自己会把自己锁在门外）", stillOk);

// 另一头：一直猜一定会被锁
__resetRateLimit();
let lockedAt = -1;
for (let i = 0; i < LIMITS.auth + 10; i++) {
  try { rateLimitCheck(reqFrom(ip), "auth"); } catch { lockedAt = i; break; }
  rateLimitFailure(reqFrom(ip), "auth");
}
check(`猜到第 ${LIMITS.auth} 次就锁住（字典攻击不成立）`, lockedAt === LIMITS.auth, `第 ${lockedAt} 次`);

// 锁的是这个来源，不是整个站点 —— 别让攻击者顺手把全家锁出去
let otherOk = true;
try { rateLimitCheck(reqFrom("203.0.113.100"), "auth"); } catch { otherOk = false; }
check("只锁猜密码的那个 IP，不影响别人", otherOk);

check("auth 桶的额度对家里宽、对脚本紧", LIMITS.auth >= 10 && LIMITS.auth <= 50, `${LIMITS.auth}/小时`);

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
