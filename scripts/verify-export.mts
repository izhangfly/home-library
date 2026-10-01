// 导出完整性测试 —— 见 app/api/export/route.ts
//
// 起因：JSON 导出漏掉了 FloorPlan 和 Room。DXF 户型图、十六个识别出来的房间、
// 手工起的名字和颜色，一个字都没导出去 —— 而 DEPLOY.md 上写着这份导出是
// "哪天想换个系统时拿来迁移"用的。书还能照着 ISBN 重扫一遍，
// 房间的轮廓和名字只存在那一处，丢了就是丢了。
//
// 漏字段这种事光靠人复查是防不住的：加一张新表的时候，没人会想起来还有个导出。
// 所以这里直接拿 prisma schema 对账 —— 每张表要么被导出，要么写明为什么不导。
//
// 跑法：npm run verify:export

import { readFileSync } from "node:fs";
import { EXPORTED_SETTINGS } from "../lib/export.ts";
import { TABLE_COVERAGE } from "../app/api/export/route";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
}

console.log("\n=== 导出完整性 ===\n");

const schema = readFileSync("prisma/schema.prisma", "utf8");
const libSrc = readFileSync("lib/export.ts", "utf8");
const routeSrc = readFileSync("app/api/export/route.ts", "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]).sort();

console.log(`schema 里有 ${models.length} 张表：${models.join(", ")}\n`);

// --- 每张表都必须在覆盖表里登记 ---
const missing = models.filter((m) => !(m in TABLE_COVERAGE));
check("A · 每张表都在导出覆盖表里登记过", missing.length === 0,
  missing.length ? `没登记：${missing.join(", ")}（要么导出，要么写明为什么不导）` : "");

// --- 覆盖表里不该有 schema 已经没有的表 ---
const stale = Object.keys(TABLE_COVERAGE).filter((t) => !models.includes(t));
check("B · 覆盖表里没有已经删掉的表", stale.length === 0, stale.join(", "));

// --- 被排除的必须给理由 ---
const excludedNoReason = Object.entries(TABLE_COVERAGE)
  .filter(([, v]) => v.startsWith("__excluded__") && v.replace("__excluded__:", "").trim() === "")
  .map(([k]) => k);
check("C · 每个被排除的表都写了理由", excludedNoReason.length === 0, excludedNoReason.join(", "));

// --- 最难重建的数据必须在里面 ---
// 书可以照着 ISBN 重扫，户型和房间不能。这几张表漏了就是不可逆的损失。
for (const t of ["FloorPlan", "Room", "Bookcase", "Level", "Placement", "Book"]) {
  const v = TABLE_COVERAGE[t];
  check(`D · ${t} 确实被导出（不是被排除）`, !!v && !v.startsWith("__excluded__"), v ?? "没登记");
}

// --- 凭证不能出现在导出里 ---
check("E · 登录会话不导出（那是后台钥匙）",
  (TABLE_COVERAGE.AdminSession ?? "").startsWith("__excluded__"));

console.log("\nF 导出不能把不该给的东西一起给出去");
// Setting 是键值表，什么都能塞。整张倒出去 = 以后谁写进一个密钥就自动泄露。
// ops.authLockout 尤其不能给：等于告诉正在爆破的人"你触发锁了没有"。
check("Setting 走白名单而不是整张导",
  /where:\s*\{\s*key:\s*\{\s*in:\s*EXPORTED_SETTINGS/.test(libSrc),
  "lib/export.ts 里应该是 findMany({ where: { key: { in: EXPORTED_SETTINGS } } })");
check("白名单里没有 ops.*",
  !EXPORTED_SETTINGS.some((k: string) => k.startsWith("ops.")),
  EXPORTED_SETTINGS.join(", "));
check("导出接口要管理员（内容含户型图和全部藏书）",
  /await requireAdmin\(\)/.test(routeSrc),
  "app/api/export/route.ts 里应该有 await requireAdmin()");

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
