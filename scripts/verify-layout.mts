// 布局算法的性质测试 —— docs/shelving-v3.md §9
//
// 这不是"跑一遍看看输出好不好看"，而是一组每次改算法都必须为真的断言。
// 第 6、7、9 条（幂等、惯性单调、确定性）是"可靠"的核心：
// 一个每次跑出不同结果、或者跑两遍还在继续搬书的算法，平均质量再好也不能用。

import { planInsert, shelfTape } from "../lib/insert";
import { planLayoutAsync } from "../lib/layout";
import {
  planLayout,
  readerOf,
  DEFAULT_WEIGHTS,
  type LayoutBook,
  type LayoutBookcase,
  type LayoutPlan,
} from "../lib/layout";
import { DEFAULT_COEFFICIENTS, estimateSpine } from "../lib/capacity";
import { reachBand } from "../lib/shelving";
import { clcSortKey, normalizeClc } from "../lib/clc";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
}

// ---------------------------------------------------------------- 造数据

/** 确定性伪随机，保证每次跑的是同一套数据 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const CLASSES = [
  "A81", "B0", "B84", "C91", "D9", "F0", "G4", "G61", "H31", "I247",
  "I28", "I512", "J2", "K23", "K5", "N4", "O1", "Q1", "R2", "TP3", "Z22",
];

function makeBooks(n: number, seed = 7): LayoutBook[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const clc = CLASSES[Math.floor(r() * CLASSES.length)] + (r() < 0.5 ? "" : `.${Math.floor(r() * 9)}`);
    const pages = 120 + Math.floor(r() * 600);
    return {
      id: `b${i}`,
      title: `书 ${i}`,
      clc,
      callSortKey: clcSortKey(normalizeClc(clc), String(i).padStart(4, "0")),
      pageCount: pages,
      binding: r() < 0.2 ? "精装" : "平装",
      heightMm: 180 + Math.floor(r() * 70),
      levelId: null,
      tagNames: [],
    };
  });
}

function makeHouse(bays: number, levelsPer: number, seed = 3): LayoutBookcase[] {
  const r = rng(seed);
  return Array.from({ length: bays }, (_, j) => {
    const levels = Array.from({ length: levelsPer }, (_, k) => ({
      id: `L${j}_${k}`,
      bookcaseId: `BC${j}`,
      levelIndex: k + 1,
      widthMm: 800,
      heightMm: 300,
      floorMm: 60 + k * 320,
    }));
    return {
      id: `BC${j}`,
      name: `柜 ${j}`,
      roomId: `R${Math.floor(j / 2)}`,
      roomName: `房间 ${Math.floor(j / 2)}`,
      x: 1000 + (j % 4) * 3000 + r() * 200,
      y: 1000 + Math.floor(j / 4) * 4000,
      levels,
    };
  });
}

/** 把规划结果写回书上，模拟"照着建议搬完了" */
function applyPlan(books: LayoutBook[], plan: LayoutPlan): LayoutBook[] {
  const at = new Map(plan.assignments.map((a) => [a.bookId, a.levelId]));
  return books.map((b) => ({ ...b, levelId: at.get(b.id) ?? b.levelId }));
}

// ---------------------------------------------------------------- 性质

function levelById(house: LayoutBookcase[]) {
  const m = new Map<string, { level: LayoutBookcase["levels"][number]; bc: LayoutBookcase }>();
  for (const bc of house) for (const l of bc.levels) m.set(l.id, { level: l, bc });
  return m;
}

function properties(house: LayoutBookcase[], books: LayoutBook[], plan: LayoutPlan, tag: string) {
  const idx = levelById(house);
  const byId = new Map(books.map((b) => [b.id, b]));

  // 1 每本书要么被安排，要么被明确列为放不下
  const accounted = new Set([...plan.assignments.map((a) => a.bookId), ...plan.unplaced.map((u) => u.bookId)]);
  check(`${tag} · 1 没有书被静默丢失`, accounted.size === books.length,
    `${accounted.size}/${books.length}`);

  // 1b 不能重复安排
  check(`${tag} · 1b 每本书只被安排一次`,
    new Set(plan.assignments.map((a) => a.bookId)).size === plan.assignments.length);

  // 2 没有层超宽
  const over = plan.levels.filter((l) => l.usedMm > l.usableMm + 0.5);
  check(`${tag} · 2 没有层超过可用宽度`, over.length === 0,
    over.map((l) => `${l.levelId} ${l.usedMm}>${l.usableMm}`).join(", "));

  // 3 没有书高过所在层
  const tooTall = plan.assignments.filter((a) => {
    const b = byId.get(a.bookId)!;
    const l = idx.get(a.levelId)!.level;
    return b.heightMm != null && b.heightMm > l.heightMm;
  });
  check(`${tag} · 3 没有书高过所在层净空`, tooTall.length === 0, `${tooTall.length} 本`);

  // 4 柜级分段连续且递增
  let monotone = true;
  for (let i = 1; i < plan.bays.length; i++) {
    if (plan.bays[i].from !== plan.bays[i - 1].to) monotone = false;
  }
  check(`${tag} · 4 柜级分段连续递增（索书号顺序没被打乱）`, monotone);

  // 5 儿童读物够得着，够不着的必须被列进例外清单（不许静默将就）
  const childBand = reachBand(140);
  const flagged = new Set(plan.exceptions.map((e) => e.bookId));
  const silent = plan.assignments.filter((a) => {
    const b = byId.get(a.bookId)!;
    if (readerOf(b).heightCm > 150) return false;
    const l = idx.get(a.levelId)!.level;
    return l.floorMm > childBand.comfortableMax && !flagged.has(a.bookId);
  });
  check(`${tag} · 5 儿童读物够得着，够不着的都被列为例外`, silent.length === 0,
    `${silent.length} 本被静默将就`);
}

// ---------------------------------------------------------------- 跑

console.log("\n=== 布局算法性质测试 ===\n");

// --- A. 冷启动：一屋子空书架 + 一堆没上架的书 ---
{
  // 用接近真实的装填水平（约七成）：书稀疏的时候算法**故意**把书集中到够得着的
  // 那几层，底层空着 —— 那是对的（家里书少时谁也不会先塞地板那一格）。
  // "空隙摊匀"这条性质只有在架子快满、摊匀真的影响下次插书时才有意义。
  const house = makeHouse(6, 5);
  const books = makeBooks(660);
  console.log("A 冷启动（6 柜 × 5 层，660 本，全部未上架）");
  const plan = planLayout(house, books);
  properties(house, books, plan, "A");
  console.log(`    代价 ${plan.cost}，搬动 ${plan.moves}，放不下 ${plan.unplaced.length}`);
  const fills = plan.levels.map((l) => l.fill);
  const avg = fills.reduce((s, x) => s + x, 0) / (fills.length || 1);
  const spread = Math.max(...fills) - Math.min(...fills);
  // 书总量不到容量的 75% 时，目标装填率是够不着的 —— 该断言的是"摊匀"，
  // 不是"达到 75%"。全屋整体装填率就是能达到的上限。
  const totalUsed = plan.levels.reduce((s, l) => s + l.usedMm, 0);
  const totalUsable = plan.levels.reduce((s, l) => s + l.usableMm, 0);
  const overall = totalUsed / totalUsable;
  console.log(`    平均装填 ${(avg * 100).toFixed(0)}%（全屋 ${(overall * 100).toFixed(0)}%），最高−最低 ${(spread * 100).toFixed(0)} 个百分点`);
  console.log(`    逐层：${plan.levels.map((l) => Math.round(l.fill * 100)).join(" ")}`);
  check("A · 各层装填率贴着全屋整体水平（±8 个百分点）", Math.abs(avg - overall) < 0.08,
    `${(avg * 100).toFixed(0)}% vs ${(overall * 100).toFixed(0)}%`);
  // 真正要守住的是"每一层都还插得进书"。塞到 100% 的层，下次上架就要推挤一整排。
  const crammed = plan.levels.filter((l) => l.fill > 0.92);
  check("A · 没有层被塞到 92% 以上（留得住下次上架的空间）", crammed.length === 0,
    `${crammed.length}/${plan.levels.length} 层超过 92%`);
  void spread;
}

// --- B. 幂等 + 确定性 ---
{
  const house = makeHouse(6, 5);
  const books = makeBooks(240);
  const first = planLayout(house, books);
  const settled = applyPlan(books, first);

  const again = planLayout(house, settled);
  console.log("\nB 幂等与确定性");
  check("B · 6 幂等：对自己的输出再跑一次，搬动数为 0", again.moves === 0, `${again.moves} 次`);

  const twice = planLayout(house, settled);
  const same = JSON.stringify(again.assignments) === JSON.stringify(twice.assignments);
  check("B · 9 确定性：同样输入两次得到完全相同的结果", same);
}

// --- C. 惯性单调 ---
{
  // 先摆好 400 本，再一口气进 200 本新书 —— 这是最真实的重规划压力：
  // 理想布局变了，但书已经在架上了。
  // （直接把书随机丢到别的层测不出旋钮：柜级顺序单调是硬约束，
  //   那些书无论如何都得挪回来，旋钮再大也压不住。）
  const house = makeHouse(6, 5);
  const books = makeBooks(400);
  const settled = applyPlan(books, planLayout(house, books));
  const incoming = makeBooks(200, 31).map((b) => ({ ...b, id: `n${b.id}` }));
  const world = [...settled, ...incoming];

  console.log("\nC 惯性旋钮");
  const moves = [0, 100, 350, 1200, 100000].map(
    (move) => planLayout(house, world, { weights: { move } }).moves,
  );
  console.log(`    w_move = 0/100/350/1200/1e5 → 搬动 ${moves.join(" / ")}`);
  let mono = true;
  for (let i = 1; i < moves.length; i++) if (moves[i] > moves[i - 1]) mono = false;
  check("C · 7 惯性单调：w_move 增大，搬动数不增", mono, moves.join(" ≥ "));
  check("C · w_move=0 时确实会大改（搬动 > 0）", moves[0] > 0);
  check("C · w_move 极大时明显比 w_move=0 少动", moves[4] < moves[0], `${moves[4]} vs ${moves[0]}`);
}

// --- D. 加一本书不会引起雪崩 ---
{
  const house = makeHouse(6, 5);
  const books = makeBooks(200);
  const settled = applyPlan(books, planLayout(house, books));
  const extra: LayoutBook = {
    id: "new1", title: "新来的", clc: "I247.5",
    callSortKey: clcSortKey("I247.5", "9999"),
    pageCount: 320, binding: "平装", heightMm: 210, levelId: null, tagNames: [],
  };
  const after = planLayout(house, [...settled, extra]);
  console.log("\nD 增量");
  console.log(`    加 1 本 → 搬动 ${after.moves} 本`);
  check("D · 8 加一本书引起的搬动有上界（< 15 本）", after.moves < 15, `${after.moves}`);
}

// --- E. 人体工学 ---
{
  const house = makeHouse(4, 6);
  // 一半儿童书，一半成人书
  const books = makeBooks(160).map((b, i) =>
    i % 2 === 0 ? { ...b, clc: "I28", callSortKey: clcSortKey("I28", String(i).padStart(4, "0")) } : b,
  );
  const plan = planLayout(house, books);
  const idx = levelById(house);
  const byId = new Map(books.map((b) => [b.id, b]));
  const childHeights = plan.assignments
    .filter((a) => (byId.get(a.bookId)!.clc ?? "").startsWith("I28"))
    .map((a) => idx.get(a.levelId)!.level.floorMm);
  const adultHeights = plan.assignments
    .filter((a) => !(byId.get(a.bookId)!.clc ?? "").startsWith("I28"))
    .map((a) => idx.get(a.levelId)!.level.floorMm);
  const avgC = childHeights.reduce((s, x) => s + x, 0) / (childHeights.length || 1);
  const avgA = adultHeights.reduce((s, x) => s + x, 0) / (adultHeights.length || 1);

  console.log("\nE 人体工学");
  console.log(`    儿童书平均离地 ${Math.round(avgC)}mm，其它书 ${Math.round(avgA)}mm`);
  properties(house, books, plan, "E");
  check("E · 儿童书平均放得比其它书低", avgC < avgA, `${Math.round(avgC)} vs ${Math.round(avgA)}`);
}

// --- F. 使用频次 → 货位 ---
{
  // 索书号顺序不能打乱，所以"常翻的放好拿的地方"只能在**类目**粒度上成立 ——
  // 同一个类里按著者号排，不可能把里面某几本单独提出来。
  // docs/shelving-v3.md §5 记了这个取舍。
  const mk = (bays: number, n: number) => {
    const house = makeHouse(bays, 6);
    const books = makeBooks(n, 11).map((b, i) => {
      const rare = i % 2 === 1;
      const clc = rare ? "Z87" : "Z22";
      return {
        ...b,
        clc,
        callSortKey: clcSortKey(clc, String(i).padStart(4, "0")),
        tagNames: rare ? [] : ["常翻"],
        binding: rare ? "期刊" : b.binding,
      };
    });
    return { house, books, plan: planLayout(house, books) };
  };

  console.log("\nF 使用频次 → 货位");

  // F1 架子紧张：只有一层算"高处"，冷门书上不去。
  //    这时正确的取舍是**先保证常翻的好拿**，冷门的去将就 —— 断言取用质量，不是绝对高度。
  {
    const { house, books, plan } = mk(3, 120);
    const idx = levelById(house);
    const byId = new Map(books.map((b) => [b.id, b]));
    const band = reachBand(160);
    const quality = (pred: (b: LayoutBook) => boolean) => {
      const qs = plan.assignments
        .filter((a) => pred(byId.get(a.bookId)!))
        .map((a) => {
          const z = idx.get(a.levelId)!.level.floorMm;
          if (z >= band.idealMin && z <= band.idealMax) return 1;
          if (z >= band.comfortableMin && z <= band.comfortableMax) return 0.5;
          return 0;
        });
      return qs.reduce((s, x) => s + x, 0) / (qs.length || 1);
    };
    const qf = quality((b) => (b.tagNames ?? []).includes("常翻"));
    const qr = quality((b) => b.binding === "期刊");
    console.log(`    架子紧张：常翻取用质量 ${qf.toFixed(2)}，期刊 ${qr.toFixed(2)}`);
    check("F1 · 架子紧张时常翻的书优先拿到黄金区", qf > qr, `${qf.toFixed(2)} vs ${qr.toFixed(2)}`);
    properties(house, books, plan, "F1");
  }

  // F2 有余量：这时"冷门的上顶层、黄金区腾给常翻的"才做得到。
  //    用单个书柜隔离这条性质 —— 多柜时算法会先把书归拢到少数几个柜子里
  //    （空柜子的代价很低，这是对的），于是又变回 F1 那种紧张局面。
  {
    const { house, books, plan } = mk(1, 40);
    const idx = levelById(house);
    const byId = new Map(books.map((b) => [b.id, b]));
    const h = (pred: (b: LayoutBook) => boolean) => {
      const zs = plan.assignments
        .filter((a) => pred(byId.get(a.bookId)!))
        .map((a) => idx.get(a.levelId)!.level.floorMm);
      return zs.reduce((s, x) => s + x, 0) / (zs.length || 1);
    };
    const freq = h((b) => (b.tagNames ?? []).includes("常翻"));
    const rare = h((b) => b.binding === "期刊");
    for (const l of plan.levels.filter((l) => l.bookIds.length)) {
      const f = l.bookIds.filter((id) => (byId.get(id)!.tagNames ?? []).includes("常翻")).length;
      const r = l.bookIds.filter((id) => byId.get(id)!.binding === "期刊").length;
      console.log(`      离地${idx.get(l.levelId)!.level.floorMm} 常翻${f} 期刊${r} 装填${Math.round(l.fill * 100)}%`);
    }
    console.log(`    有余量：常翻平均离地 ${Math.round(freq)}mm，期刊 ${Math.round(rare)}mm`);
    check("F2 · 有余量时冷门书被推到更高处", rare > freq, `期刊 ${Math.round(rare)} vs 常翻 ${Math.round(freq)}`);
  }
}

// --- G. 学科邻近：断口落在学科缝上 ---
{
  const house = makeHouse(4, 5);
  // 四个界限分明的大类，各 60 本
  const groups = ["B84", "I247", "K23", "TP3"];
  const books: LayoutBook[] = [];
  groups.forEach((g, gi) => {
    for (let i = 0; i < 60; i++) {
      books.push({
        id: `${g}-${i}`, title: `${g} ${i}`, clc: g,
        callSortKey: clcSortKey(g, String(gi * 100 + i).padStart(4, "0")),
        pageCount: 300, binding: "平装", heightMm: 210, levelId: null, tagNames: [],
      });
    }
  });
  const plan = planLayout(house, books);
  console.log("\nG 学科邻近");
  for (const b of plan.bays) console.log(`    ${b.bookcaseName}: 第 ${b.from}–${b.to} 本，主类 ${b.label}`);
  // 每个柜子应该基本只装一个大类
  const idx = levelById(house);
  const byId = new Map(books.map((b) => [b.id, b]));
  const perBay = new Map<string, Set<string>>();
  for (const a of plan.assignments) {
    const bc = idx.get(a.levelId)!.bc.id;
    const cls = (byId.get(a.bookId)!.clc ?? "").slice(0, 1);
    perBay.set(bc, (perBay.get(bc) ?? new Set()).add(cls));
  }
  const mixed = [...perBay.values()].filter((s) => s.size > 2).length;
  check("G · 没有柜子混进 3 个以上大类", mixed === 0, `${mixed} 个柜子`);
  properties(house, books, plan, "G");
}

// --- H. 规模与耗时 ---
//
// 这一段要跑 6 次整屋规划（1000 本和 5000 本各三次取最快），单独就占 17 秒 ——
// 比其余 77 条性质断言加起来还多一个数量级。
// 性质断言是**改完随手跑**的东西，被这一段拖到十几秒就没人随手跑了。
// 所以默认跳过，`verify:full`（部署走的那条）才跑。
if (!process.env.LAYOUT_PERF) {
  console.log("\nH 规模 —— 跳过（要跑：LAYOUT_PERF=1，或 npm run verify:full）");
} else {
  const house = makeHouse(20, 6);
  const books = makeBooks(5000, 99);
  console.log("\nH 规模");
  // 卡的是**增长趋势**，不是墙钟秒数。
  //
  // 原来写的是"5000 本必须 2 秒内跑完"，而这道断言挂在部署闸门上。
  // 同一份代码在这台机器上实测跑出过 1922 / 2365 / 4536ms，
  // 而且 A/B 过：**上一个提交更慢**（2785 / 2860ms）。
  // 也就是说它量的是"这台笔记本此刻有多闲"，不是"这段代码有多快"。
  // 一个会随机变红的闸门，结局一定是被 --skip-verify 绕过去 ——
  // 那这道闸门就等于不存在，比没有更糟（还给人虚假的安全感）。
  //
  // 真正要防的是**复杂度炸掉**：书变 5 倍，时间不该变几十倍。
  // 比值在同一台机器同一时刻测出来，机器忙不忙对分子分母影响一样，
  // 约掉了。绝对值只留一个很松的上限当兜底。
  //
  // 另外：服务端本来就走 planLayoutAsync（每 40ms 让出事件循环），
  // 所以绝对耗时长一点不会卡住别人扫码 —— 这也是绝对值不值得死卡的原因。
  const timeIt = (bs: typeof books) => {
    let best = Infinity;
    let out!: ReturnType<typeof planLayout>;
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const r = planLayout(house, bs);
      const took = Date.now() - t0;
      if (took < best) { best = took; out = r; }
    }
    return { ms: best, plan: out };
  };
  const small = timeIt(makeBooks(1000, 99));
  const big = timeIt(books);
  const ms = big.ms;
  const plan = big.plan;
  const ratio = ms / Math.max(1, small.ms);
  console.log(`    1000 本 → ${small.ms}ms，5000 本 → ${ms}ms（各三次取最快），比值 ${ratio.toFixed(1)}×`);
  console.log(`    5000 本 × 20 柜 × 6 层：安排 ${plan.assignments.length}，放不下 ${plan.unplaced.length}`);
  // 书 ×5，时间 ×15 以内。真炸了（比如退化成平方）会是几十上百倍。
  check("H · 10 书量 ×5 时耗时不超过 ×15（不许复杂度炸掉）", ratio <= 15, `${ratio.toFixed(1)}×`);
  // 兜底上限放得很松：只拦"慢到完全不可用"，不拦机器忙
  check("H · 11 5000 本仍在 15 秒内（很松的兜底）", ms < 15000, `${ms}ms`);
  console.log(`    人体工学例外 ${plan.exceptions.length} 条（挤不下时的让步，全部列出）`);
  properties(house, books, plan, "H");
}

// --- I. 装不下时诚实报告 ---
{
  const house = makeHouse(1, 2); // 只有 2 层，装不下 300 本
  const books = makeBooks(300, 5);
  const plan = planLayout(house, books);
  console.log("\nI 容量不足");
  console.log(`    安排 ${plan.assignments.length}，明确报告放不下 ${plan.unplaced.length}`);
  check("I · 装不下的书被明确列出而不是悄悄丢掉",
    plan.assignments.length + plan.unplaced.length === books.length,
    `${plan.assignments.length}+${plan.unplaced.length} vs ${books.length}`);
  check("I · 放不下的都给了原因", plan.unplaced.every((u) => !!u.reason));
}

// --- J. 太高的书 ---
{
  const house = makeHouse(2, 4);
  const books = makeBooks(60, 21).map((b, i) => (i === 3 ? { ...b, heightMm: 900 } : b));
  const plan = planLayout(house, books);
  console.log("\nJ 超高书");
  const flagged = plan.unplaced.find((u) => u.bookId === "b3");
  check("J · 900mm 高的书被判为放不下并注明原因",
    !!flagged && flagged.reason === "too_tall_anywhere",
    flagged ? flagged.reason : "没被标出来");
  properties(house, books, plan, "J");
}

// --- K. 在线插入：推挤而不是乱丢（docs §7）---
{
  console.log("\nK 在线插入（推挤）");
  const house = makeHouse(3, 4);
  const books = makeBooks(150, 41);
  const settled = applyPlan(books, planLayout(house, books));

  const tape = shelfTape(house, settled);
  const byLevel = new Map(tape.map((t) => [t.level.id, [] as LayoutBook[]]));
  for (const b of settled) if (b.levelId) byLevel.get(b.levelId)?.push(b);

  /** 把整屋按带的顺序摊平成一条索书号序列，检查它是不是升序 */
  const isOrdered = (place: Map<string, LayoutBook[]>) => {
    const flat = tape.flatMap((t) =>
      [...(place.get(t.level.id) ?? [])].sort((a, b) => a.callSortKey.localeCompare(b.callSortKey)),
    );
    for (let i = 1; i < flat.length; i++) {
      if (flat[i - 1].callSortKey.localeCompare(flat[i].callSortKey) > 0) return false;
    }
    return true;
  };

  // K1 插到一层还有空的地方 —— 一本都不该动
  {
    const fresh: LayoutBook = {
      id: "k1", title: "新书", clc: "I247.5", callSortKey: clcSortKey("I247.5", "5000"),
      pageCount: 200, binding: "平装", heightMm: 200, levelId: null, tagNames: [],
    };
    const plan = planInsert(fresh, house, settled);
    console.log(`    有空位：${plan.outcome} / ${plan.reason}，推挤 ${plan.shifts.length} 本`);
    check("K1 · 有空位时直接放下，不动别人", plan.outcome === "fits" && plan.shifts.length === 0,
      `${plan.outcome} 推了 ${plan.shifts.length}`);
    check("K1 · 给出了具体的层", !!plan.targetLevelId);
  }

  // K2 目标层塞满时应该**推挤**，而不是把书丢到别的空层
  {
    // 手工摆一个真正塞满的第一层 —— 不能用 planLayout 来造，
    // 它现在**故意**给每层留余量（≤92%），根本压不出满层。
    const tight = makeHouse(1, 3);
    // 还没有书的时候方向无从判断，用空带定出"第一层/第二层"，摆好之后再重算
    const tape0 = shelfTape(tight);
    const top = tape0[0].level;   // 带的第一层
    const mid = tape0[1].level;
    const per = 26;
    const fitTop = Math.floor((top.widthMm - 10) / per);   // 恰好铺满

    const packed: LayoutBook[] = [
      ...Array.from({ length: fitTop }, (_, i) => ({
        id: `f${i}`, title: `填充 ${i}`, clc: "I247",
        callSortKey: clcSortKey("I247", String((i + 1) * 10).padStart(4, "0")),
        spineMm: per, pageCount: null, binding: "平装", heightMm: 200,
        levelId: top.id, tagNames: [] as string[],
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `m${i}`, title: `中层 ${i}`, clc: "I247",
        callSortKey: clcSortKey("I247", String((fitTop + i + 1) * 10).padStart(4, "0")),
        spineMm: per, pageCount: null, binding: "平装", heightMm: 200,
        levelId: mid.id, tagNames: [] as string[],
      })),
    ];

    const tapeT = shelfTape(tight, packed);
    const before = new Map(tapeT.map((t) => [t.level.id, [] as LayoutBook[]]));
    for (const b of packed) before.get(b.levelId!)!.push(b);
    check("K2 · 前置条件：初始排列本身是有序的", isOrdered(before));
    check("K2 · 前置条件：第一层确实满了",
      fitTop * per > top.widthMm - 10 - per, `${fitTop * per}/${top.widthMm - 10}`);

    // 一本该插到最前面的书 —— 正是最容易被"丢到空层"处理坏的情形
    const head: LayoutBook = {
      id: "k2", title: "该排在最前面的书",
      clc: "I247", callSortKey: clcSortKey("I247", "0005"),
      spineMm: per, pageCount: null, binding: "平装", heightMm: 200, levelId: null, tagNames: [],
    };
    const plan = planInsert(head, tight, packed);
    console.log(`    满层插队：${plan.outcome} / ${plan.reason}，推挤 ${plan.shifts.length} 本`);
    check("K2 · 满层插队时发生推挤（而不是另找空层）",
      plan.outcome === "cascade" && plan.shifts.length > 0, `${plan.outcome} 推了 ${plan.shifts.length}`);
    check("K2 · 新书确实落在它按索书号该在的那一层", plan.targetLevelId === top.id,
      `${plan.targetLevelId} vs ${top.id}`);
    check("K2 · 推挤量很小（≤2 本）", plan.shifts.length <= 2, `${plan.shifts.length}`);

    // 应用这份方案，检查顺序还在、没有层超宽
    const after = new Map([...before].map(([k, v]) => [k, [...v]]));
    for (const sh of plan.shifts) {
      const from = after.get(sh.fromLevelId)!;
      const idx = from.findIndex((b) => b.id === sh.bookId);
      if (idx >= 0) after.get(sh.toLevelId)!.push(...from.splice(idx, 1));
    }
    if (plan.targetLevelId) after.get(plan.targetLevelId)!.push(head);
    check("K2 · 推挤之后整屋索书号顺序仍然是升序", isOrdered(after));

    const overfull = tapeT.filter((t) => {
      const w = (after.get(t.level.id) ?? []).reduce((s, b) => s + (b.spineMm ?? 0), 0);
      return w > t.level.widthMm - 10;
    });
    check("K2 · 推挤之后没有层超宽", overfull.length === 0, `${overfull.length} 层`);
  }

  // K3 推不动了要老实说，不能悄悄塞
  {
    const full = makeHouse(1, 1);
    const filler: LayoutBook[] = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`, title: `满 ${i}`, clc: "I247",
      callSortKey: clcSortKey("I247", String(i * 10).padStart(4, "0")),
      spineMm: 26, pageCount: null, binding: "平装", heightMm: 200,
      levelId: full[0].levels[0].id, tagNames: [],
    }));
    const head: LayoutBook = {
      id: "k3", title: "塞不下的", clc: "I247", callSortKey: clcSortKey("I247", "0005"),
      spineMm: 26, pageCount: null, binding: "平装", heightMm: 200, levelId: null, tagNames: [],
    };
    const plan = planInsert(head, full, filler);
    console.log(`    无处可推：${plan.outcome} / ${plan.reason}`);
    check("K3 · 推不动时明确报 needs_review 而不是硬塞",
      plan.outcome === "needs_review", `${plan.outcome}`);
  }

  // K4 超高的书直接说放不下
  {
    const plan = planInsert(
      { id: "k4", title: "巨册", clc: "J2", callSortKey: clcSortKey("J2", "0001"),
        pageCount: 300, binding: "精装", heightMm: 900, levelId: null, tagNames: [] },
      house, settled,
    );
    check("K4 · 比所有层都高的书报 too_tall", plan.reason === "too_tall", plan.reason);
  }

  // K6 带的方向必须跟着**架上实际怎么摆的**走，不能写死"从上往下"。
  //    这是线上真出过的错：用户的书从最底层往上摆（第 1 层 I247 → 第 4 层 N4），
  //    带却按图书馆惯例从上往下读，于是一本 I516 被算成该放在装着 N4 的最上层。
  {
    const bay = makeHouse(1, 4);
    const lv = [...bay[0].levels].sort((a, b) => a.levelIndex - b.levelIndex); // 1..4
    const mk = (id: string, clc: string, cut: string, levelIndex: number): LayoutBook => ({
      id, title: id, clc, callSortKey: clcSortKey(clc, cut),
      spineMm: 25, pageCount: null, binding: "平装", heightMm: 200,
      levelId: lv[levelIndex].id, tagNames: [],
    });
    // 由下而上递增：第 1 层 I247 → 第 4 层 N4
    const shelved = [
      mk("a", "I247.5", "0001", 0),
      mk("b", "I247.57", "0002", 1),
      mk("c", "K5", "0003", 2),
      mk("d", "N4", "0004", 3),
    ];
    const fresh: LayoutBook = {
      id: "k6", title: "少年维特（I516）", clc: "I516.44",
      callSortKey: clcSortKey("I516.44", "0009"),
      spineMm: 25, pageCount: null, binding: "平装", heightMm: 200, levelId: null, tagNames: [],
    };
    const plan = planInsert(fresh, bay, shelved);
    const idxOf = (id: string | null) => lv.findIndex((l) => l.id === id) + 1;
    console.log(`    自下而上摆放：I516 被安排到第 ${idxOf(plan.targetLevelId)} 层`);
    // I516 排在 I247.57 之后、K5 之前。接在 I247 那层末尾、或插在 K5 那层开头，
    // 两种都不破坏顺序，所以这里断言的是**方向读对了**：绝不能落到 N4 那层去。
    // （具体挑哪一层由学科邻近决定，见 K8。）
    check("K6 · 带的方向跟着架上实际摆法走（I516 落在 I247/K5 之间，不是 N4 那层）",
      plan.targetLevelId === lv[1].id || plan.targetLevelId === lv[2].id,
      `落在第 ${idxOf(plan.targetLevelId)} 层（N4 在第 4 层）`);

    // 反过来：由上而下递增的柜子也要判对
    const flipped = shelved.map((b, i) => ({ ...b, levelId: lv[3 - i].id }));
    const plan2 = planInsert(fresh, bay, flipped);
    check("K6 · 反过来（自上而下递增）同样判对",
      plan2.targetLevelId === lv[2].id || plan2.targetLevelId === lv[1].id,
      `落在第 ${idxOf(plan2.targetLevelId)} 层（N4 在第 1 层）`);
  }

  // K7 落在两层之间时，挑不用推挤/余量更大的那层，而不是死板地取后一层
  {
    const bay = makeHouse(1, 3);
    const lv = [...bay[0].levels].sort((a, b) => a.levelIndex - b.levelIndex);
    const mk = (id: string, cut: string, levelIndex: number, spine = 25): LayoutBook => ({
      id, title: id, clc: "I247", callSortKey: clcSortKey("I247", cut),
      spineMm: spine, pageCount: null, binding: "平装", heightMm: 200,
      levelId: lv[levelIndex].id, tagNames: [],
    });
    // 第 1 层很空（2 本），第 2 层几乎塞满
    const shelved = [
      mk("p1", "0010", 0), mk("p2", "0020", 0),
      ...Array.from({ length: 29 }, (_, i) => mk(`q${i}`, String(100 + i * 10).padStart(4, "0"), 1)),
    ];
    // 索书号落在 p2(0020) 和 q0(0100) 之间 —— 两层都放得下顺序
    const between: LayoutBook = {
      id: "k7", title: "夹在中间的", clc: "I247", callSortKey: clcSortKey("I247", "0050"),
      spineMm: 25, pageCount: null, binding: "平装", heightMm: 200, levelId: null, tagNames: [],
    };
    const plan = planInsert(between, bay, shelved);
    const idxOf = (id: string | null) => lv.findIndex((l) => l.id === id) + 1;
    console.log(`    夹在两层之间：落到第 ${idxOf(plan.targetLevelId)} 层，推挤 ${plan.shifts.length} 本`);
    check("K7 · 夹在两层之间时落到空的那层，不推挤",
      plan.targetLevelId === lv[0].id && plan.shifts.length === 0,
      `第 ${idxOf(plan.targetLevelId)} 层，推 ${plan.shifts.length}`);
  }

  // K8 夹在两层之间且两层都放得下时，跟同类走，而不是跟余量走
  {
    const bay = makeHouse(1, 3);
    const lv = [...bay[0].levels].sort((a, b) => a.levelIndex - b.levelIndex);
    const mk = (id: string, clc: string, cut: string, levelIndex: number): LayoutBook => ({
      id, title: id, clc, callSortKey: clcSortKey(clc, cut),
      spineMm: 25, pageCount: null, binding: "平装", heightMm: 200,
      levelId: lv[levelIndex].id, tagNames: [],
    });
    // 第 1 层是 I247（同类，但书多一点），第 2 层是 K23（异类，空一些）
    const shelved = [
      ...Array.from({ length: 8 }, (_, i) => mk(`i${i}`, "I247", String((i + 1) * 10).padStart(4, "0"), 0)),
      ...Array.from({ length: 3 }, (_, i) => mk(`k${i}`, "K23", String((i + 1) * 10).padStart(4, "0"), 1)),
    ];
    // I247.9 排在第 1 层最后一本之后、第 2 层第一本之前
    const fresh: LayoutBook = {
      id: "k8", title: "同类新书", clc: "I247.9", callSortKey: clcSortKey("I247.9", "0500"),
      spineMm: 25, pageCount: null, binding: "平装", heightMm: 200, levelId: null, tagNames: [],
    };
    const plan = planInsert(fresh, bay, shelved);
    const idxOf = (id: string | null) => lv.findIndex((l) => l.id === id) + 1;
    console.log(`    两层都放得下：落到第 ${idxOf(plan.targetLevelId)} 层（第 1 层是同类 I247）`);
    check("K8 · 两层都放得下时跟同类走（落在 I247 那层，不是更空的 K23 那层）",
      plan.targetLevelId === lv[0].id, `落在第 ${idxOf(plan.targetLevelId)} 层`);
  }

  // K5 确定性
  {
    const fresh: LayoutBook = {
      id: "k5", title: "新书", clc: "K23", callSortKey: clcSortKey("K23", "3000"),
      pageCount: 200, binding: "平装", heightMm: 200, levelId: null, tagNames: [],
    };
    const a = planInsert(fresh, house, settled);
    const b = planInsert(fresh, house, settled);
    check("K5 · 同样输入两次得到相同的插入方案", JSON.stringify(a) === JSON.stringify(b));
  }
}

// --- L. 切片版必须和同步版结果完全一致 ---
{
  // 服务端跑的是 planLayoutAsync（每 40ms 让出事件循环，免得一个人规划把全家卡住）。
  // 它和 planLayout 共用同一个生成器，所以**必须**一字不差地一致 ——
  // 否则测试测的是一套代码，线上跑的是另一套。
  console.log("\nL 切片版与同步版等价");
  const house = makeHouse(8, 5);
  const books = makeBooks(900, 77);
  const sync = planLayout(house, books);
  const sliced = await planLayoutAsync(house, books, {}, 5);
  check("L · 搬动数一致", sync.moves === sliced.moves, `${sync.moves} vs ${sliced.moves}`);
  check("L · 代价一致", sync.cost === sliced.cost, `${sync.cost} vs ${sliced.cost}`);
  check("L · 每一本书的落点都一致",
    JSON.stringify(sync.assignments) === JSON.stringify(sliced.assignments));
  check("L · 放不下 / 例外清单一致",
    JSON.stringify(sync.unplaced) === JSON.stringify(sliced.unplaced) &&
    JSON.stringify(sync.exceptions) === JSON.stringify(sliced.exceptions));
}

// --- M. 小类合并要被说出来 ---
{
  // 用户明确要求过：几个装不满一层的小类拼到一起时，要主动告知拼了哪些。
  // 只报 dominantClass 的话，界面上只显示最大的那个类，其余凭空消失 ——
  // 人走到架子前才发现"这儿怎么还有别的书"。
  console.log("\nM 小类合并的说明");
  const house = makeHouse(1, 4);
  // 五个大类，每类三本 —— 谁也占不满一层，必然要拼
  const mini: LayoutBook[] = [];
  ["B84", "F0", "N4", "R2", "Z22"].forEach((clc, gi) => {
    for (let i = 0; i < 3; i++) {
      mini.push({
        id: `${clc}-${i}`, title: `${clc} 第${i}本`, clc,
        callSortKey: clcSortKey(clc, String(gi * 10 + i).padStart(4, "0")),
        pageCount: 260, binding: "平装", heightMm: 210, levelId: null, tagNames: [],
      });
    }
  });
  const plan = planLayout(house, mini);
  const mergedLevels = plan.merges.length;
  const namedClasses = new Set(plan.merges.flatMap((m) => m.classes.map((c) => c.clc)));
  console.log(`    ${mini.length} 本 / 5 个大类 → ${mergedLevels} 层被判为「合并」，点名 ${namedClasses.size} 个大类`);
  for (const m of plan.merges) {
    console.log(`      ${m.levelId}: ${m.classes.map((c) => `${c.clc}×${c.count}`).join(" + ")}`);
  }
  check("M · 确实报出了合并的层", mergedLevels > 0);
  check("M · 合并说明里每个类都点了名（不能只说最大的那个）",
    plan.merges.every((m) => m.classes.length >= 2));
  check("M · 每层的 classes 加起来等于该层的书数",
    plan.levels.every((l) => l.classes.reduce((s, c) => s + c.count, 0) === l.bookIds.length));
  check("M · 合并说明覆盖了那一层上的全部大类",
    plan.merges.every((m) => {
      const lvl = plan.levels.find((l) => l.levelId === m.levelId)!;
      return m.classes.length === new Set(lvl.classes.map((c) => c.clc)).size;
    }));
  // 反面：一层上只有一个大类时不该report成「合并」
  const single = planLayout(makeHouse(1, 4), mini.filter((b) => b.clc === "B84"));
  check("M · 只有一个大类时不报合并", single.merges.length === 0, `${single.merges.length}`);
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
void DEFAULT_WEIGHTS;
void DEFAULT_COEFFICIENTS;
void estimateSpine;
