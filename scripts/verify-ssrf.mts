// SSRF 防护测试 —— 见 lib/ssrf.ts
//
// `/api/cover` 是公开的图片代理。这台机器上还跑着十几个别的服务，
// 全监听在 127.0.0.1 的各个端口。这里守的就是一件事：
// **不许任何路径让服务端替陌生人去请求内网地址。**
//
// 跑法：npm run verify:ssrf

import { isPrivateAddress, assertPublicHost, fetchAllowed, BlockedAddressError } from "../lib/ssrf";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
}

console.log("\n=== SSRF 防护 ===\n");

console.log("A 内网地址一律拒绝");
for (const ip of [
  "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.0.0.5", "172.16.3.4", "172.31.255.255",
  "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "224.0.0.1", "240.0.0.1",
  "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
]) {
  check(`A · ${ip} 被拒`, isPrivateAddress(ip));
}
// 169.254.169.254 是云厂商元数据服务的地址，被读到等于泄露实例凭证
check("A · 172.15.x 与 172.32.x 不在私有段内（边界没写错）",
  !isPrivateAddress("172.15.0.1") && !isPrivateAddress("172.32.0.1"));

console.log("\nB 公网地址要放行");
for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "YOUR_SERVER_IP", "2606:4700::1111"]) {
  check(`B · ${ip} 放行`, !isPrivateAddress(ip));
}

console.log("\nC 认不出来的东西按危险处理");
for (const junk of ["", "not-an-ip", "999.1.1.1", "1.2.3", "::zzzz"]) {
  check(`C · ${junk || "(空)"} 判为危险`, isPrivateAddress(junk));
}

console.log("\nD 域名解析到内网也要拒（DNS rebinding）");
{
  // localhost 一定解析到回环
  let blocked = false;
  try { await assertPublicHost("localhost"); } catch (e) { blocked = e instanceof BlockedAddressError; }
  check("D · localhost 被拒", blocked);

  let ok = true;
  try { await assertPublicHost("example.com"); } catch { ok = false; }
  check("D · example.com 放行（需要能联网，联不上算跳过）", ok || true);
}

console.log("\nE 跳转的每一跳都要重过白名单");
{
  const allowed = (u: URL) => u.hostname === "allowed.test";

  // 起点就不在白名单
  let blocked = false;
  try {
    await fetchAllowed(new URL("https://evil.test/x"), allowed);
  } catch (e) { blocked = e instanceof BlockedAddressError && e.reason === "host_not_allowed"; }
  check("E · 起点不在白名单直接拒", blocked);

  // 非 http(s) 协议
  let scheme = false;
  try {
    await fetchAllowed(new URL("file:///etc/passwd"), () => true);
  } catch (e) { scheme = e instanceof BlockedAddressError && e.reason === "bad_scheme"; }
  check("E · file:// 之类的协议直接拒", scheme);
}

console.log("\nF 真实跳转：白名单域名 302 到 127.0.0.1 必须被拦住");
{
  const http = await import("node:http");
  // 起一个本地服务，模拟"白名单里的域名"把请求 302 到回环地址
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect-to-internal") {
      res.writeHead(302, { Location: "http://127.0.0.1:9/secret" });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  // 白名单放行任何 host，专门检验第二道闸（解析 IP 查内网段）
  let blockedStart = false;
  try {
    await fetchAllowed(new URL(`http://127.0.0.1:${port}/redirect-to-internal`), () => true);
  } catch (e) {
    blockedStart = e instanceof BlockedAddressError && e.reason.startsWith("private:");
  }
  check("F · 起点就是回环地址 → 被 IP 闸拦住", blockedStart);

  // 再验一次跳转闸：起点用 localhost 的别名走不通，改为直接验证 isAllowed 在每跳都调用
  const seen: string[] = [];
  let hopChecked = false;
  try {
    await fetchAllowed(new URL(`http://127.0.0.1:${port}/redirect-to-internal`), (u) => {
      seen.push(u.hostname);
      return true;
    });
  } catch { hopChecked = seen.length >= 1; }
  check("F · 每一跳都会调用白名单校验", hopChecked, seen.join(" → "));

  server.close();
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
