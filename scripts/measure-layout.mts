// 上架算法的**质量**度量 —— 不是"有没有崩"，是"排出来的架好不好"
//
// verify:layout 那 77 条是性质测试：幂等、确定性、顺序不乱、惯性单调。
// 它们全过了，也只证明算法**没坏**，一个字都没说它排得**好不好**。
// 而用户真正担心的恰恰是后者："书特别多的时候完全没法预测，
// 有些区被撑大、有些被挤掉、被挪到别处去。"
//
// 而且到今天为止，整套东西只在 6 本书上跑过。
//
// 这里造一个规模真实的家庭藏书（中图法分布按真实家庭藏书的样子倾斜），
// 在几个量级上跑，量五件用户能感觉到的事：
//   1. 同类书有没有被拆散（碎片化）—— 找书时最痛的就是这个
//   2. 索书号相邻的两本，物理上离多远（多尺度距离到底有没有生效）
//   3. 童书是不是真的在低处
//   4. 不常翻的是不是真的在高处
//   5. 装填率的离散程度 + 耗时
//
// 跑法：npx tsx scripts/measure-layout.mts [--books 2000]

import { planLayout, orderBooks, type LayoutBook, type LayoutBookcase, type LayoutLevel, usageOf, levelFloorRank } from "../lib/layout.ts";
import { normalizeClc } from "../lib/clc.ts";

const N = Number(process.argv.find((a) => a.startsWith("--books="))?.slice(8) ?? 0);

// 确定性随机，好复现
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

// 真实家庭藏书的中图法分布（权重 = 大致本数占比）
const MIX: [string, number][] = [
  ["I247", 14], ["I267", 6], ["I712", 8], ["I561", 4], ["I521", 2],  // 文学：中外小说散文
  ["I28", 12],                                                        // 童书 —— 家里孩子多
  ["TP3", 9], ["TP18", 4],                                            // 计算机
  ["K23", 5], ["K54", 3], ["K81", 3],                                 // 历史传记
  ["B84", 4], ["B22", 3],                                             // 心理/哲学
  ["F27", 4], ["F83", 2],                                             // 经管
  ["O1", 3], ["O4", 2], ["Q9", 2],                                    // 数理生
  ["J21", 2], ["J6", 2],                                              // 艺术
  ["H31", 3], ["H16", 2], ["Z22", 1],                                 // 语言/工具书
  ["G61", 3], ["R15", 2],                                             // 育儿/健康
];
const POOL = MIX.flatMap(([c, w]) => Array(w).fill(c) as string[]);

function makeBooks(n: number): LayoutBook[] {
  const books: LayoutBook[] = [];
  for (let i = 0; i < n; i++) {
    const base = pick(POOL);
    // 同一小类里再散开一层小数，模拟真实索书号的密度
    const clc = rnd() < 0.6 ? `${base}.${Math.floor(rnd() * 9)}` : base;
    const tags: string[] = [];
    if (rnd() < 0.06) tags.push("常翻");
    if (rnd() < 0.03) tags.push("借出");
    books.push({
      id: `b${i}`,
      title: `书${i}`,
      clc,
      callSortKey: `${clc}/${String(i).padStart(5, "0")}`,
      spineMm: Math.round(8 + rnd() * 32),          // 8–40mm，真实脊厚
      heightMm: Math.round(180 + rnd() * 80),       // 180–260mm
      binding: rnd() < 0.04 ? "期刊" : "平装",
      levelId: null,
      tagNames: tags,
    });
  }
  return books.sort((a, b) => a.callSortKey.localeCompare(b.callSortKey));
}

/** 造柜子：三个房间，每房 2–3 个柜，每柜 5–6 层 */
function makeBookcases(capacityMm: number): LayoutBookcase[] {
  const rooms = [
    { id: "r1", name: "客厅", x: 0, y: 0 },
    { id: "r2", name: "书房", x: 6000, y: 0 },
    { id: "r3", name: "儿童房", x: 0, y: 5000 },
  ];
  const cases: LayoutBookcase[] = [];
  let made = 0;
  let idx = 0;
  while (made < capacityMm) {
    const room = rooms[idx % rooms.length];
    const nLevels = 5 + (idx % 2);
    const levels: LayoutLevel[] = [];
    for (let l = 0; l < nLevels; l++) {
      levels.push({
        id: `L${idx}-${l}`,
        bookcaseId: `bc${idx}`,
        levelIndex: l + 1,
        widthMm: 760,
        heightMm: l === 0 ? 320 : 270,                 // 最底层高一点，放大开本
        floorMm: 80 + l * 300,                          // 80 / 380 / 680 / 980 / 1280 / 1580
      });
      made += 760;
    }
    cases.push({
      id: `bc${idx}`, name: `${room.name}书柜${Math.floor(idx / 3) + 1}`,
      roomId: room.id, roomName: room.name,
      x: room.x + (idx % 3) * 1200, y: room.y,
      levels,
    });
    idx++;
  }
  return cases;
}

const mainClass = (clc: string | null) => (normalizeClc(clc) ?? "?").match(/^[A-Z]+\d?/)?.[0] ?? "?";

let failed = 0;
const assert = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(18)} ${detail}`);
  if (!ok) failed++;
};

function report(n: number) {
  const books = makeBooks(n);
  const totalSpine = books.reduce((s, b) => s + (b.spineMm ?? 20), 0);
  const cases = makeBookcases(totalSpine / 0.75);      // 造到 75% 目标装填
  const levels = cases.flatMap((c) => c.levels);

  const t0 = performance.now();
  const plan = planLayout(cases, books);
  const ms = performance.now() - t0;

  const levelById = new Map(levels.map((l) => [l.id, l]));
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const placed = new Map(plan.assignments.map((a) => [a.bookId, a.levelId]));

  // ---- 1. 碎片化：一个小类被拆到几层上
  const byClass = new Map<string, Set<string>>();
  for (const b of books) {
    const lv = placed.get(b.id); if (!lv) continue;
    const k = (normalizeClc(b.clc) ?? "?").split(".")[0];
    (byClass.get(k) ?? byClass.set(k, new Set()).get(k)!).add(lv);
  }
  const spreads = [...byClass.values()].map((s) => s.size);
  const frag = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const worstFrag = Math.max(...spreads);

  // ---- 2. 索书号相邻的两本，物理距离
  const dist = (l1: string, l2: string) => {
    const a = levelById.get(l1)!, b = levelById.get(l2)!;
    if (a.id === b.id) return 0;
    if (a.bookcaseId === b.bookcaseId) return 1 + Math.abs(a.levelIndex - b.levelIndex);   // 同柜换层
    const ca = caseById.get(a.bookcaseId)!, cb = caseById.get(b.bookcaseId)!;
    if (ca.roomId === cb.roomId) return 20 + Math.hypot(ca.x - cb.x, ca.y - cb.y) / 500;   // 同屋换柜
    return 100;                                                                             // 换屋
  };
  // **按算法自己的排架顺序**量，不是按纯索书号。
  // 一开始拿索书号顺序量，结果引入排架序列之后跨房间从 2 跳到 166 ——
  // 但那正是序列**有意**要拆开的相邻关系（童书不再和成人书插在一起）。
  // 用户走到架前体验到的是排架顺序，量错了对象会把改进读成退步。
  const tape = orderBooks(books);
  let hops = 0, sameLevel = 0, crossRoom = 0, pairs = 0;
  for (let i = 1; i < tape.length; i++) {
    const p = placed.get(tape[i - 1].id), q = placed.get(tape[i].id);
    if (!p || !q) continue;
    const d = dist(p, q); hops += d; pairs++;
    if (d === 0) sameLevel++; if (d >= 100) crossRoom++;
  }

  // ---- 3/4. 童书在不在低处、少翻的在不在高处
  const floorOf = (id: string) => levelById.get(placed.get(id)!)?.floorMm ?? NaN;
  const isChild = (b: LayoutBook) => ["I28","G61","G62","J218","Z228"].some((p) => (normalizeClc(b.clc) ?? "").startsWith(p));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const childFloor = avg(books.filter((b) => isChild(b) && placed.has(b.id)).map((b) => floorOf(b.id)));
  const otherFloor = avg(books.filter((b) => !isChild(b) && placed.has(b.id)).map((b) => floorOf(b.id)));
  const rareFloor = avg(books.filter((b) => usageOf(b) === "rare" && placed.has(b.id)).map((b) => floorOf(b.id)));
  const freqHigh = books.filter((b) => usageOf(b) === "frequent" && placed.has(b.id) &&
    levelFloorRank(levelById.get(placed.get(b.id)!)!) === "high").length;
  const freqTotal = books.filter((b) => usageOf(b) === "frequent").length;

  // ---- 5. 装填率离散 + 未安置
  const used = plan.levels.filter((l) => l.bookIds.length);
  const fills = used.map((l) => l.fill);
  const mean = avg(fills);
  const sd = Math.sqrt(avg(fills.map((f) => (f - mean) ** 2)));

  const sameLevelPct = 100 * sameLevel / pairs;

  console.log(`\n=== ${n} 本 / ${cases.length} 柜 / ${levels.length} 层 ===`);
  assert("全都安置了", plan.unplaced.length === 0 && plan.exceptions.length === 0,
    `未安置 ${plan.unplaced.length}，异常 ${plan.exceptions.length}`);
  assert("相邻的书挨着", sameLevelPct >= 90 && crossRoom <= 5,
    `同层 ${sameLevelPct.toFixed(1)}%（要 ≥90），跨房间 ${crossRoom} 次（要 ≤5），平均距离 ${(hops / pairs).toFixed(2)}`);
  assert("童书在低处", childFloor < otherFloor,
    `童书 ${childFloor.toFixed(0)}mm vs 其它 ${otherFloor.toFixed(0)}mm`);
  assert("常翻的没上高处", freqHigh === 0, `${freqHigh} / ${freqTotal} 本常翻书在高处`);
  assert("装填率合理", mean >= 0.6 && mean <= 0.85 && sd <= 0.3,
    `平均 ${(100 * mean).toFixed(1)}%（要 60–85），标准差 ${(100 * sd).toFixed(1)}pt（要 ≤30），空层 ${plan.levels.length - used.length}`);
  assert("跑得够快", ms < 1000 + n * 1.2, `${ms.toFixed(0)} ms`);
  console.log(`  · 同类碎片化 平均 ${frag.toFixed(2)} 层/类（最大类本来就要占很多层，仅供参考，不设阈值）`);
  // **故意不断言"冷门书在高处"** —— 它现在做不到，而且是结构性做不到的，
  // 原因和证据都写在 lib/layout.ts 的 ZONE_COST 上面。
  // 这里如实把数字打出来，好让人一眼看见它没实现，而不是假装没这回事；
  // 但不设成失败项 —— 设了只会诱使下一个人去调权重，而调权重只会把整库往下压。
  console.log(`  · 少翻的离地 ${rareFloor.toFixed(0)}mm vs 其它 ${otherFloor.toFixed(0)}mm —— 已知做不到，见 layout.ts 的 ZONE_COST 注释`);
}

export { makeBooks, makeBookcases };
if (!process.env.MEASURE_IMPORT) {
  for (const n of N ? [N] : [200, 1000, 3000]) report(n);
  console.log(failed ? `\n=== ${failed} 项不合格 ===\n` : "\n=== 排架质量全部达标 ===\n");
  process.exit(failed ? 1 : 0);
}
