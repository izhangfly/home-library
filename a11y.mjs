import { chromium } from "playwright";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let axePath;
try { axePath = require.resolve("axe-core/axe.min.js"); } catch { console.log("axe-core 没装"); process.exit(2); }
import { readFileSync } from "node:fs";
const axeSrc = readFileSync(axePath, "utf8");
const BASE = "https://library.example.com";
const PAGES = ["/", "/scan", "/books", "/map", "/space", "/reflow", "/labels", "/shelves", "/settings"];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
const p = await ctx.newPage();
await p.goto(`${BASE}/shelves`, { waitUntil: "networkidle" });
const pw = await p.$('input[type=password]');
if (pw) { await pw.fill("101103YOUyou"); await p.click('button[type=submit]'); await p.waitForTimeout(2500); }
const all = new Map();
for (const path of PAGES) {
  await p.goto(BASE + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(path === "/space" || path === "/map" ? 3000 : 1500);
  await p.evaluate(axeSrc);
  const r = await p.evaluate(async () => await window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  for (const v of r.violations) {
    const k = v.id;
    if (!all.has(k)) all.set(k, { impact: v.impact, help: v.help, pages: new Set(), nodes: [] });
    all.get(k).pages.add(path);
    all.get(k).nodes.push(...v.nodes.slice(0, 2).map(n => n.html.slice(0, 100)));
  }
}
await p.request.delete(`${BASE}/api/auth`);
await b.close();
if (!all.size) { console.log("\n没有 WCAG A/AA 违规 ✓\n"); process.exit(0); }
console.log(`\n=== ${all.size} 类违规 ===`);
for (const [id, v] of [...all].sort((a,b)=>b[1].pages.size-a[1].pages.size)) {
  console.log(`\n[${v.impact}] ${id} —— ${v.help}`);
  console.log(`  出现在: ${[...v.pages].join(" ")}`);
  console.log(`  例: ${v.nodes[0]}`);
}
