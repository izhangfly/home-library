// 端到端冒烟测试 —— 对着**真正跑着的站点**走一遍主要流程
//
// 为什么需要它：项目里有 218 条单元级断言，但它们全在进程内跑，
// 碰不到「页面渲染出来了没、接口和组件对不对得上、控制台有没有报错」。
// 这一路的浏览器验证全是临时写完就删的脚本 —— 又是"习惯不是机制"：
// 下一次改动没人会想起来再跑一遍。
//
// 这里只做冒烟：每页打开、关键内容在、没有控制台报错、没有 4xx/5xx。
// 不做交互断言（那些留给各自的验证脚本），因为冒烟测试一旦开始测细节
// 就会变脆，然后就没人跑了。
//
// 跑法：node scripts/smoke.mjs [--base https://...]

import { chromium } from "playwright";

const BASE =
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ??
  "https://library.example.com";
const PASSWORD = process.env.HL_ADMIN_PASSWORD ?? "101103YOUyou";

/** 每页：路径 + 必须出现的东西（缺了就说明这页其实是坏的，只是没报错） */
const PAGES = [
  { path: "/", must: ["藏书总数", "最近录入"] },
  { path: "/scan", must: ["扫码"] },
  { path: "/books", must: ["书目"] },
  { path: "/map", must: ["书架地图"] },
  { path: "/space", must: ["3D 空间"] },
  { path: "/reflow", must: ["理架"] },
  { path: "/labels", must: ["打印书脊标签"] },
  { path: "/shelves", must: ["书架结构", "户型图", "房间"] },
  { path: "/settings", must: ["设置"] },
];

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();

// 收集问题：控制台报错 和 失败的请求。按页归档。
let consoleErrors = [];
let badResponses = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const txt = m.text();
  // 浏览器扩展/网络抖动导致的图片加载失败不算应用的错
  if (/favicon|ERR_INTERNET_DISCONNECTED/i.test(txt)) return;
  consoleErrors.push(txt.slice(0, 120));
});
page.on("response", (r) => {
  if (r.status() < 400) return;
  // 未登录时后台接口返回 401 是**正确行为**，不算故障
  if (r.status() === 401) return;
  badResponses.push(`${r.status()} ${r.url().replace(BASE, "")}`);
});

console.log(`\n=== 冒烟测试 ${BASE} ===\n`);

// 先登录：书架结构那些页面要管理员才看得到全部内容
await page.goto(`${BASE}/shelves`, { waitUntil: "networkidle" });
const pw = await page.$('input[type=password]');
if (pw) {
  await pw.fill(PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
}
check("管理员登录", !(await page.$('input[type=password]')));

for (const { path, must } of PAGES) {
  consoleErrors = [];
  badResponses = [];
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  // 客户端组件要时间取数、画图（3D 尤其慢）
  await page.waitForTimeout(path === "/space" || path === "/map" ? 3500 : 2000);

  const body = (await page.innerText("body")).replace(/\s+/g, " ");
  const missing = must.filter((m) => !body.includes(m));
  check(`${path} 打开且内容齐全`, missing.length === 0, missing.length ? `缺: ${missing.join(", ")}` : "");
  check(`${path} 没有控制台报错`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
  check(`${path} 没有失败的请求`, badResponses.length === 0, badResponses.slice(0, 3).join(" | "));

  // 一直转圈 = 取数失败却没有兜底，是这个项目专门修过的一类问题
  check(`${path} 没有卡在「加载中」`, !/加载中…/.test(body));
}

// ---------------------------------------------------------------- 匿名（没登录）
//
// 上面九页全是**登录之后**跑的。可这个应用最主要的用法恰恰是没登录的那个：
// 「妹妹拿手机扫码加书」—— 加书、上架、传封面都**故意**不要密码，
// 只有改书架结构才要（lib/auth.ts 的两级权限）。
// 这条边界以前只写在 CLAUDE.md 里当注意事项，没有任何东西守着它：
// 哪天有人"顺手"给 /api/books 加个 requireAdmin，家里人那条路当场就断了，
// 而九个页面用管理员身份跑起来全是绿的，谁也发现不了。
//
// 两个方向都要测。只测一头（就像限流那次）会得到一个看着能过、实际没用的检查。
// 用空 body POST：能过鉴权的会撞到参数校验（422），**一个字节都不会写进库**。
const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
const ap = await anon.newPage();

// 这里必须卡 4xx，不能只写"不是 401"。
// 第一版就是只写了"不是 401"—— /api/upload 返回 500 照样打勾，
// 而那个 500 是真 bug：空 body 让 req.formData() 抛了，没人接，
// 冒成"服务器错误"。**垃圾输入永远不该产生 5xx。**
for (const ep of ["books", "placements", "upload"]) {
  const r = await ap.request.post(`${BASE}/api/${ep}`, { data: {}, failOnStatusCode: false });
  const st = r.status();
  check(`匿名能用 /api/${ep}（家里人不用密码）`, st >= 400 && st < 500 && st !== 401, `返回了 ${st}`);
}

// 坏 JSON / 断掉的 body 是**客户端**的问题，得说"重试"，不能说"服务器错误"
{
  const r = await ap.request.post(`${BASE}/api/books`, {
    headers: { "content-type": "application/json" },
    // 必须发**原始字节**：给 data 传字符串的话 Playwright 会再 JSON 编码一次，
    // 于是发出去的是一个合法的 JSON 字符串，撞到的是 Zod（422）而不是解析失败。
    data: Buffer.from('{"title": broken'),
    failOnStatusCode: false,
  });
  const body = await r.text();
  check("坏 JSON 报 400 bad_body（不是 500）", r.status() === 400 && body.includes("bad_body"), `${r.status()} ${body.slice(0, 60)}`);
}
for (const ep of ["bookcases", "levels", "rooms"]) {
  const r = await ap.request.post(`${BASE}/api/${ep}`, { data: {}, failOnStatusCode: false });
  check(`匿名改不了 /api/${ep}（改结构要密码）`, r.status() === 401, `返回了 ${r.status()}`);
}

// 要密码的页面得**说清楚为什么**，不能只甩一个密码框
for (const path of ["/shelves", "/settings"]) {
  await ap.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await ap.waitForTimeout(1500);
  const body = (await ap.innerText("body")).replace(/\s+/g, " ");
  check(`${path} 匿名时要密码且讲清了原因`, !!(await ap.$("input[type=password]")) && /不需要密码/.test(body));
}

// 扫码那页是家里人的入口，没登录也必须完整可用
await ap.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
await ap.waitForTimeout(1500);
const scanBody = (await ap.innerText("body")).replace(/\s+/g, " ");
check("匿名的扫码页可用", /开启摄像头/.test(scanBody) && /手动输入条码/.test(scanBody) && !(await ap.$("input[type=password]")));

// 手机竖屏：这个应用主要在手机上用，横向溢出等于不能用
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mobile.newPage();
let overflow = [];
for (const { path } of PAGES) {
  await mp.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await mp.waitForTimeout(1500);
  const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 1) overflow.push(`${path}(+${over}px)`);
}
check("手机竖屏没有横向溢出", overflow.length === 0, overflow.join(" "));

// 退出登录 —— 这个脚本现在**每次部署都跑**，不收拾的话 AdminSession 里
// 就会一直堆测试留下的 30 天钥匙（这个库以前攒到过 32 条，31 条是测试的）。
// createSession 有 10 条的上限兜底，但那是兜底，不是理由。
await page.request.delete(`${BASE}/api/auth`);

await browser.close();
console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
