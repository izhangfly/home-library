// 「临界情况必须交给用户」的守卫 —— spec F3 验收条件 2
//
// 服务端在 /api/placements 上有两道 409：
//   too_tall           书比层高还高
//   needs_confirmation 宽度临界 / 层矮到书高未知会出事 / 厚度靠猜且这层快满了
// 它们是这个应用**唯一**会拦住你的地方，也是它最有价值的时刻 ——
// 你还站在电脑前，还没抱着一摞书走到架子跟前。
//
// 但客户端只要在请求里带上 `force: true`，这两道全部作废。
// 而这正是发生过的事：ShelvingPicker（扫码、书籍详情、手动录入都用它）
// 无条件发 `confirmedByUser: true, force: true`，于是
// "这层只剩 8mm" 和 "这本书比层高 20mm" 都被静默放行了。
// 光靠人复查是防不住的：那行代码看起来完全合理，注释还写着"用户已经看过了"。
//
// 跑法：npm run verify:confirm

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "generated" || n === ".next") return [];
    const full = join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(n) ? [full] : [];
  });
}

console.log("\n=== 临界确认不许被绕过 ===\n");

// ---------------------------------------------------------------- 服务端
// 这两道拦截 2026-08 从路由挪进了 lib/placeService.ts（上架要在事务里锁层，
// 事务边界属于业务逻辑不属于路由）。两个文件都读进来一起查 ——
// 只盯路由那一个文件的话，代码一搬家，这个守卫就变成永远绿的摆设。
const api = ["app/api/placements/route.ts", "lib/placeService.ts"]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

check("A · 服务端仍然会因为「书太高」返回 409",
  /fail\("too_tall",\s*409/.test(api) || /PlaceRejected\("too_tall",\s*409/.test(api));
check("A · 服务端仍然会因为「临界」返回 409",
  /fail\("needs_confirmation",\s*409/.test(api) || /PlaceRejected\("needs_confirmation",\s*409/.test(api));
check("A · 两道拦截都只在用户明确 force 时才跳过",
  /fit\.height === "too_tall" && !input\.force/.test(api) &&
  /fit\.needsManualConfirm && !input\.confirmedByUser && !input\.force/.test(api));

// ---------------------------------------------------------------- 客户端
// 找出所有往 /api/placements 发 POST 的地方，检查有没有写死的 force。
const files = [...walk("components"), ...walk("app")].filter((f) => !f.startsWith("app/api"));
const offenders: string[] = [];
const callers: string[] = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!src.includes('"/api/placements"')) continue;
  callers.push(f);

  // 取每个 apiPost("/api/placements", {...}) 的实参片段
  for (const m of src.matchAll(/apiPost\(\s*"\/api\/placements"\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
    const args = m[1];
    // 写死的 force: true / confirmedByUser: true —— 没有任何条件包着，就是绕过
    if (/(^|[\s,{])force:\s*true/.test(args) && !/\?|\.\.\.\(/.test(args)) {
      offenders.push(`${f} → ${args.replace(/\s+/g, " ").trim().slice(0, 90)}`);
    }
  }
}

console.log(`  （检查了 ${callers.length} 个调用点：${callers.map((f) => f.split("/").pop()).join(", ")}）`);

check("B · 没有任何客户端无条件带 force: true", offenders.length === 0, offenders.join("\n      "));

// ---------------------------------------------------------------- 有没有人接住 409
// 拦住了却没人显示，等于没拦 —— 用户只会看到一句"保存失败"。
const handlers = callers.filter((f) => {
  const src = readFileSync(f, "utf8");
  return src.includes("needs_confirmation") || src.includes("too_tall");
});
check("C · 每个调用点都接住了 409 并给用户交代",
  handlers.length === callers.length,
  `只有 ${handlers.map((f) => f.split("/").pop()).join(", ")} 处理了；` +
  `没处理的：${callers.filter((f) => !handlers.includes(f)).map((f) => f.split("/").pop()).join(", ")}`);

console.log("\nD 删柜子/删层也要先问清楚");
// 级联删除一次能抹掉几百本书的位置，而放**一本**书进临界层都要 409 确认。
// 服务端必须自己拦，不能只靠客户端那句 confirm ——
// 只放在客户端的判断，换个调用方就没了（B 段守的就是这件事）。
for (const f of ["app/api/bookcases/[id]/route.ts", "app/api/levels/[id]/route.ts"]) {
  const src = readFileSync(f, "utf8");
  check(`${f.split("/").slice(-3)[0]} 删除前先数书并回 409`,
    /fail\("has_books",\s*409/.test(src) && /placement\.count/.test(src),
    "应该 placement.count 之后 fail(\"has_books\", 409, { books })");
  check(`${f.split("/").slice(-3)[0]} 确认过才放行（force）`,
    /force/.test(src), "要支持 ?force=1 让用户确认后重发");
}
const admin = readFileSync("components/ShelvesAdmin.tsx", "utf8");
check("界面把真实本数说出来，而不是一句笼统的提示",
  /has_books/.test(admin) && /HasBooks/.test(admin),
  "应该接住 409 并用带 count 的文案再问一次");

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
