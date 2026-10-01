// 无障碍回归 —— 对着真站点跑 axe
//
// 为什么必须是机制而不是"记得跑一次"：这个项目的三个无障碍问题
// （SVG 房间能点不能聚焦、30 个只有图标的按钮没有名字、主色黄底白字 1.56:1）
// 全是当初手工查出来的，查完脚本就删了。之后界面改了十几轮，没人再查过。
// 而且我自己就在上一次修复里留了个新洞：把房间做成键盘可达之后，
// 它们仍然被关在一个 role="img" 的 <svg> 里 —— 声明成"一张图"，
// 里面却有能聚焦的控件。axe 一跑就报 nested-interactive。
//
// 只卡 WCAG 2.0/2.1 的 A 与 AA：这是有客观标准的部分。
// 主观的易用性留给人看。
//
// 跑法：npm run verify:a11y [--base https://...]
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7)
  ?? "https://library.example.com";
const PASSWORD = process.env.HL_ADMIN_PASSWORD ?? "101103YOUyou";
const PAGES = ["/", "/scan", "/books", "/map", "/space", "/reflow", "/labels", "/shelves", "/settings"];

let axeSrc;
try {
  axeSrc = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
} catch {
  console.log("\n=== 无障碍 ===\n  · 没装 axe-core，跳过\n");
  process.exit(0);
}

const browser = await chromium.launch().catch(() => null);
if (!browser) { console.log("\n=== 无障碍 ===\n  · 起不了浏览器，跳过\n"); process.exit(0); }

const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
try {
  await page.goto(`${BASE}/shelves`, { waitUntil: "networkidle", timeout: 20000 });
} catch {
  await browser.close();
  console.log(`\n=== 无障碍 ===\n  · 连不上 ${BASE}，跳过（这项要有跑着的站点）\n`);
  process.exit(0);
}

const pw = await page.$("input[type=password]");
if (pw) { await pw.fill(PASSWORD); await page.click("button[type=submit]"); await page.waitForTimeout(2500); }

console.log("\n=== 无障碍（WCAG 2.1 A/AA） ===\n");
const found = new Map();
for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(path === "/space" || path === "/map" ? 3000 : 1500);
  await page.evaluate(axeSrc);
  const r = await page.evaluate(async () => await window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  for (const v of r.violations) {
    if (!found.has(v.id)) found.set(v.id, { impact: v.impact, help: v.help, pages: [], example: v.nodes[0]?.html.slice(0, 110) });
    found.get(v.id).pages.push(path);
  }
  console.log(`  ${r.violations.length ? "✗" : "✓"} ${path}${r.violations.length ? `  ${r.violations.map((v) => v.id).join(", ")}` : ""}`);
}

// 跑完自己退出登录，别给 AdminSession 攒 30 天的钥匙
await page.request.delete(`${BASE}/api/auth`);
await browser.close();

if (found.size) {
  console.log(`\n${found.size} 类违规：`);
  for (const [id, v] of found) {
    console.log(`\n  [${v.impact}] ${id} —— ${v.help}`);
    console.log(`    页面: ${v.pages.join(" ")}`);
    console.log(`    例:   ${v.example}`);
  }
  console.log();
  process.exit(1);
}
console.log("\n=== 没有 WCAG A/AA 违规 ===\n");
