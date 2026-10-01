// 插入一本书的**六种解释**都要对
//
// planInsert 的 `reason` 是直接给用户看的：ShelvingPicker 里
// `t("insert.reason." + ins.reason)` 一行渲染出去。而这条路是这个应用里
// 跑得最勤的 —— 每加一本书都要走一遍。
//
// 可六个 reason 里，原来只有 `too_tall` 在测试里被断言过一次，其余五个
// （direct / pushed / budget_exceeded / ran_out_of_shelves / no_shelves）
// 一次都没有。也就是说：放不下时给的那句解释，从来没人验过对不对 ——
// 而"为什么放不下"恰恰是用户最需要看懂的一句话。
import { readFileSync } from "node:fs";
import { planInsert } from "../lib/insert.ts";
import type { LayoutBook, LayoutBookcase, LayoutLevel } from "../lib/layout.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  —— " + detail : ""}`);
  ok ? pass++ : fail++;
};

const level = (id: string, idx: number, widthMm = 1000, heightMm = 300): LayoutLevel =>
  ({ id, bookcaseId: "bc", levelIndex: idx, widthMm, heightMm, floorMm: 200 + idx * 300 });

const house = (levels: LayoutLevel[]): LayoutBookcase[] =>
  [{ id: "bc", name: "柜", roomId: "r", roomName: "屋", x: 0, y: 0, levels }];

let seq = 0;
const book = (clc: string, spineMm = 30, heightMm = 200): LayoutBook => ({
  id: `b${seq++}`, title: clc, clc, callSortKey: `${clc}/${String(seq).padStart(4, "0")}`,
  spineMm, heightMm, levelId: null,
});
const on = (b: LayoutBook, levelId: string): LayoutBook => ({ ...b, levelId });

console.log("\n=== 插入的六种解释 ===\n");

// no_shelves —— 一层书架都还没有
{
  const p = planInsert(book("I247"), [], []);
  check("没有任何层 → no_shelves", p.reason === "no_shelves" && p.outcome === "needs_review", p.reason);
  check("没有层时不瞎指一个目标层", p.targetLevelId === null, String(p.targetLevelId));
}

// too_tall —— 比每一层都高
{
  const ls = [level("L1", 1, 1000, 250)];
  const p = planInsert(book("I247", 30, 400), house(ls), []);
  check("比所有层都高 → too_tall", p.reason === "too_tall", p.reason);
}

// direct —— 空位够，谁都不用动
{
  const ls = [level("L1", 1)];
  const shelved = [on(book("I100"), "L1"), on(book("I300"), "L1")];
  const p = planInsert(book("I200"), house(ls), shelved);
  check("空位够 → direct / fits", p.reason === "direct" && p.outcome === "fits", `${p.reason}/${p.outcome}`);
  check("direct 时一本都不推", p.shifts.length === 0, `推了 ${p.shifts.length} 本`);
}

// pushed —— 本层满了，往后推几本
//
// 新书的号必须落在**本层中间**，不能落在层与层的交界上。
// 第一版就写错了：L1 是 I200..I232，我插了个 I250 —— 它排在全部之后，
// 于是算法把它放到 L2 开头，一本没推，返回 direct。那是**对的行为**
// （代码里专门写了这个边界情形：接上一层末尾或插下一层开头都不破坏顺序，
// 挑不用推的那个），错的是我的用例。
// 号之间留出间隔，插一个夹在中间的。
const ls = [level("L1", 1), level("L2", 2)];
{
  const shelved = [
    ...Array.from({ length: 33 }, (_, i) => on(book(`I${200 + i * 10}`), "L1")),
    on(book("K100"), "L2"),
  ];
  const p = planInsert(book("I355"), house(ls), shelved, { budget: 40 });
  check("本层满了但后面有空 → pushed / cascade",
    p.reason === "pushed" && p.outcome === "cascade", `${p.reason}/${p.outcome}`);
  check("pushed 时确实推了书", p.shifts.length > 0, `推了 ${p.shifts.length} 本`);
}

// budget_exceeded —— 推得动，但要推的比预算多
//
// 要造出**多级**推挤：L1 满、L2 也满、L3 空。
// 插进 L1 中间 → L1 挤一本去 L2 → L2 再挤一本去 L3，一共两次搬动。
// 预算给 1，就该判 budget_exceeded。
// （第一版偷懒把预算设成 1、只需要推 1 本，那当然不超 —— 又是用例写错，不是代码错。）
{
  const ls3 = [level("L1", 1), level("L2", 2), level("L3", 3)];
  const shelved = [
    ...Array.from({ length: 33 }, (_, i) => on(book(`I${200 + i * 10}`), "L1")),
    ...Array.from({ length: 33 }, (_, i) => on(book(`K${200 + i * 10}`), "L2")),
  ];
  const p = planInsert(book("I355"), house(ls3), shelved, { budget: 1 });
  check("要推的超过预算 → budget_exceeded",
    p.reason === "budget_exceeded" && p.outcome === "needs_review", `${p.reason}/${p.outcome}`);
}

// ran_out_of_shelves —— 从插入点往后全满，推到头也腾不出来
{
  const shelved = [
    ...Array.from({ length: 33 }, (_, i) => on(book(`I${200 + i * 10}`), "L1")),
    ...Array.from({ length: 33 }, (_, i) => on(book(`K${200 + i * 10}`), "L2")),
  ];
  const p = planInsert(book("I355"), house(ls), shelved, { budget: 200 });
  check("往后全满、推到头 → ran_out_of_shelves",
    p.reason === "ran_out_of_shelves" && p.outcome === "needs_review", `${p.reason}/${p.outcome}`);
}

// 每个 reason 都得有话可说
//
// 界面是 `t(\`insert.reason.${ins.reason}\`)` —— **动态拼出来的键**。
// check:i18n 那道反向检查只认字面量 t("...")，看不见这种；
// 于是哪天加了第七种 reason 却忘了配文案，用户看到的就是一个键名
// （第一轮修过的 MISSING_MESSAGE 就是这个形状）。
const ALL_REASONS = [
  "direct", "pushed", "budget_exceeded", "ran_out_of_shelves", "too_tall", "no_shelves",
] as const;
console.log("\n每种解释都要有文案");
for (const lang of ["zh", "en"] as const) {
  const pack = JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"));
  const missing = ALL_REASONS.filter((r) => !pack.insert?.reason?.[r]);
  check(`${lang} 六种 reason 的文案齐全`, missing.length === 0, `缺 ${missing.join(", ")}`);
}
// 反过来也查：文案里有、代码里已经不用的，是重构留下的垃圾
for (const lang of ["zh", "en"] as const) {
  const pack = JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"));
  const extra = Object.keys(pack.insert?.reason ?? {}).filter((k) => !ALL_REASONS.includes(k as never));
  check(`${lang} 没有多余的 reason 文案`, extra.length === 0, `多了 ${extra.join(", ")}`);
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
