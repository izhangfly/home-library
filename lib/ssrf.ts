// SSRF 防护 —— 服务端按用户给的 URL 去抓东西时用
//
// 背景：`/api/cover` 是个公开的图片代理。它有域名白名单，看起来够了，
// 但白名单**只在第一跳生效**：`fetch` 默认跟随跳转，白名单里的域名
// （尤其 googleusercontent.com 这种任何人都能往上放内容的）只要 302 一下，
// 就能把请求带到任意地址去。
//
// 这台机器上还跑着十几个别的服务，全都监听在 127.0.0.1 的各个端口上。
// 一个匿名的互联网用户如果能让服务端替他去请求 127.0.0.1:8520，
// 那些服务就等于被开了个后门。
//
// 所以两道闸：
//   1. 每一跳都重新过域名白名单（手动跟跳转，不让 fetch 自己跟）
//   2. 每一跳都把域名解析成 IP，落在内网/回环/链路本地段一律拒绝
//      —— 这一条同时挡住 DNS rebinding：域名在白名单里，但解析到 127.0.0.1

import { lookup } from "node:dns/promises";

export class BlockedAddressError extends Error {
  constructor(readonly reason: string) {
    super(`blocked_address:${reason}`);
  }
}

/** IPv4 点分十进制 → 32 位整数 */
function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** 需要拒绝的 IPv4 段（CIDR） */
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],        // 本网络
  ["10.0.0.0", 8],       // 私有
  ["100.64.0.0", 10],    // 运营商级 NAT
  ["127.0.0.0", 8],      // 回环 —— 这台机器上十几个服务都在这儿
  ["169.254.0.0", 16],   // 链路本地（云厂商的元数据服务也在这段）
  ["172.16.0.0", 12],    // 私有
  ["192.0.0.0", 24],     // IETF 协议专用
  ["192.168.0.0", 16],   // 私有
  ["198.18.0.0", 15],    // 基准测试
  ["224.0.0.0", 4],      // 组播
  ["240.0.0.0", 4],      // 保留
];

export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase();

  // IPv6 里嵌 IPv4（::ffff:127.0.0.1）要按里面那个 v4 判
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (addr.includes(":")) {
    if (addr === "::" || addr === "::1") return true;          // 未指定 / 回环
    // 先确认它真的是个 IPv6：每一段都得是合法十六进制。
    // 少了这一步，`::zzzz` 的首段解析成空串、再 parseInt 成 0，就被判成公网了。
    if (!addr.split(":").every((g) => /^[0-9a-f]{0,4}$/.test(g))) return true;
    const head = addr.split(":").find((g) => g !== "") ?? "0";
    const first = parseInt(head, 16);
    if (Number.isNaN(first)) return true;                       // 认不出来就拒
    if ((first & 0xfe00) === 0xfc00) return true;               // fc00::/7 唯一本地
    if ((first & 0xffc0) === 0xfe80) return true;               // fe80::/10 链路本地
    return false;
  }

  const n = v4ToInt(addr);
  if (n === null) return true; // 解析不出来就当危险
  return V4_BLOCKED.some(([base, bits]) => {
    const b = v4ToInt(base)!;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (b & mask) >>> 0;
  });
}

/** 解析域名并确认它不指向内网。DNS rebinding 就挡在这里。 */
export async function assertPublicHost(hostname: string): Promise<void> {
  // 直接写 IP 的情况，lookup 会原样返回，一样能判
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedAddressError("dns_failed");
  }
  if (!records.length) throw new BlockedAddressError("dns_empty");
  for (const r of records) {
    if (isPrivateAddress(r.address)) throw new BlockedAddressError(`private:${r.address}`);
  }
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 最多跟几次跳转 */
  maxHops?: number;
}

/**
 * 按白名单抓取，**每一跳都重新校验**。
 * 自己跟跳转而不是交给 fetch，就是为了让白名单在每一跳都生效。
 */
export async function fetchAllowed(
  start: URL,
  isAllowed: (u: URL) => boolean,
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxHops = opts.maxHops ?? 3;
  let url = start;

  for (let hop = 0; hop <= maxHops; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new BlockedAddressError("bad_scheme");
    }
    if (!isAllowed(url)) throw new BlockedAddressError("host_not_allowed");
    await assertPublicHost(url.hostname);

    const res = await fetch(url, {
      redirect: "manual", // 关键：不让 fetch 自己跟，跳转目标要重新过闸
      headers: opts.headers,
      signal: opts.signal,
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      url = new URL(loc, url); // 相对跳转也要还原成绝对地址
      continue;
    }
    return res;
  }
  throw new BlockedAddressError("too_many_redirects");
}
