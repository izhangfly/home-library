import { chromium } from "playwright";
const BASE="https://library.example.com";
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto(BASE+"/reflow",{waitUntil:"networkidle"}); await p.waitForTimeout(2500);
const el = await p.$("text=重试");
console.log("HTML:", (await el.evaluate(e => e.parentElement.parentElement.outerHTML)).slice(0,600));
console.log("\n位置:", JSON.stringify(await el.boundingBox()));
