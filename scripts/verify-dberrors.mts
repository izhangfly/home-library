// 数据库约束必须翻成人话 —— 见 lib/api.ts 的 handleError
//
// 起因：应用代码里一处 Prisma 错误处理都没有，于是每一次约束冲突都变成
// `500 internal_error`。实测到的三条：
//
//   同 ISBN 再建一本   → 500（该说"这本书已经在库里了"）
//   同名标签再建一个   → 500（该说"这个标签名已经有了"）
//   删一本不存在的书   → 500（该说 404，多半是别人刚删掉的）
//
// 这不是边角情况。这个应用是**给全家一起用**的（spec 明确要求妹妹也能扫码），
// 两个人同时扫同一本书就会撞上：两边的查重都通过，数据库的唯一约束挡住第二次写入。
// 那一刻数据库做对了事，而界面告诉用户"服务器错误"。
//
// 跑法：npm run verify:dberrors

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
}

console.log("\n=== 数据库约束的错误翻译 ===\n");

const api = readFileSync("lib/api.ts", "utf8");

console.log("A 服务端把 Prisma 错误码翻成合适的 HTTP 状态");
check("A · 认得 Prisma 的已知错误类型",
  /PrismaClientKnownRequestError/.test(api));
check("A · P2002（唯一约束）→ 409 already_exists",
  /case "P2002"[\s\S]{0,400}?fail\("already_exists",\s*409/.test(api));
check("A · P2002 回传冲突信息（模型 + 字段）",
  /case "P2002"[\s\S]{0,300}?uniqueMeta/.test(api));
// 用了 driver adapter 之后 meta.target 是 undefined —— 照文档写会得到空数组。
// 必须同时认得 driverAdapterError 那条路，否则这个字段永远是空的。
check("A · 认得 driver adapter 下的 meta 形状（不能只看 meta.target）",
  /driverAdapterError/.test(api) && /modelName/.test(api));
check("A · P2025（记录不存在）→ 404 not_found",
  /case "P2025"[\s\S]{0,200}?fail\("not_found",\s*404/.test(api));
check("A · P2003（外键仍被引用）→ 409 still_referenced",
  /case "P2003"[\s\S]{0,200}?fail\("still_referenced",\s*409/.test(api));

// 翻译必须发生在兜底的 500 **之前**，否则永远走不到
const idxPrisma = api.indexOf("PrismaClientKnownRequestError");
const idxFallback = api.indexOf('fail("internal_error", 500)');
check("A · 翻译排在兜底 500 之前（顺序反了就等于没写）",
  idxPrisma > 0 && idxFallback > idxPrisma, `${idxPrisma} vs ${idxFallback}`);

console.log("\nB 前端把这些码说给用户听");
const client = readFileSync("lib/client.ts", "utf8");
check("B · 有统一的错误码 → 文案 映射", /export function apiErrorKey/.test(client));
for (const [code, key] of [
  ["already_exists", "errors.alreadyExists"],
  ["not_found", "errors.goneAlready"],
  ["still_referenced", "errors.stillReferenced"],
]) {
  check(`B · ${code} 有对应文案`, new RegExp(`case "${code}":\\s*return "${key}"`).test(client));
}

console.log("\nC 文案两种语言都在");
const zh = JSON.parse(readFileSync("messages/zh.json", "utf8")) as Record<string, Record<string, string>>;
const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, Record<string, string>>;
for (const k of ["alreadyExists", "goneAlready", "stillReferenced"]) {
  check(`C · errors.${k} 中英都有`, !!zh.errors?.[k] && !!en.errors?.[k]);
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
