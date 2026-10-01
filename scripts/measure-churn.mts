// 加一本书要动多少本 —— 增量稳定性
//
// measure:layout 量的是"一次性排好一屋子书"排得好不好。但真实用法不是这样：
// 用户是**一本一本**加进来的。用户原话就是担心这个 ——
// "有些区被撑大、有些被挤掉、被挪到别处去"。
//
// 这里量的是**扰动放大倍数**：加一本书，系统建议搬动多少本？
// 理想是 O(1)（在插入点附近推挤几本），最坏是 O(n)（整屋重排）。
// 后者在现实里意味着：你加一本书，应用让你把两百本书从架上搬下来重排一遍 ——
// 没有人会照做，然后整个上架建议就废了。
//
// 性质测试里有"惯性单调"，但那只保证"惯性权重越大搬得越少"，
// **没有任何一条说过绝对值是多少**。
import { planLayout, orderBooks, type LayoutBook } from "../lib/layout.ts";
import { makeBooks, makeBookcases } from "./measure-layout.mts";

let failed = 0;
const assert = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(22)} ${detail}`);
  if (!ok) failed++;
};

function run(n: number, adds: number, fill = 0.72) {
  const all = makeBooks(n + adds);
  const base = all.slice(0, n);
  const newcomers = all.slice(n);
  const cases = makeBookcases(all.reduce((s, b) => s + (b.spineMm ?? 20), 0) / fill);

  // 先排好一屋子，并把结果当成"架上现状"
  let plan = planLayout(cases, base);
  let shelved: LayoutBook[] = base.map((b) => ({
    ...b,
    levelId: plan.assignments.find((a) => a.bookId === b.id)?.levelId ?? null,
  }));

  const churn: number[] = [];
  for (const nb of newcomers) {
    const next = [...shelved, { ...nb, levelId: null }];
    plan = planLayout(cases, next);
    // 有多少**本来就在架上**的书被要求换层
    const moved = plan.assignments.filter((a) => {
      const cur = shelved.find((s) => s.id === a.bookId);
      return cur && cur.levelId && cur.levelId !== a.levelId;
    }).length;
    churn.push(moved);
    shelved = next.map((b) => ({
      ...b,
      levelId: plan.assignments.find((a) => a.bookId === b.id)?.levelId ?? b.levelId,
    }));
  }

  churn.sort((a, b) => a - b);
  const sum = churn.reduce((a, b) => a + b, 0);
  const median = churn[Math.floor(churn.length / 2)];
  const p90 = churn[Math.floor(churn.length * 0.9)];
  const worst = churn[churn.length - 1];

  console.log(`\n=== 藏书 ${n} 本，逐本加入 ${adds} 本（架子装到 ${Math.round(fill * 100)}%）===`);
  console.log(`  每加一本要搬动：中位 ${median}，p90 ${p90}，最差 ${worst}，平均 ${(sum / adds).toFixed(1)}`);
  // 阈值跟着装填率走 —— 架子塞到 99% 时还要求"加书不动别的书"是**违反物理**的：
  // 没有空隙，就只能靠推挤腾出来。这里断言的是"在还有余量时要稳"，
  // 以及"任何时候都不至于整屋重排"。
  const tight = fill >= 0.97;
  assert("有余量时加书几乎不动别的", tight || median <= 2, `中位 ${median} 本（装填 ${Math.round(fill * 100)}%）`);
  assert("任何时候都不至于整屋重排", worst <= Math.max(20, n * 0.05),
    `最差 ${worst} 本（上限 ${Math.max(20, Math.round(n * 0.05))}）`);
  return { median, p90, worst };
}

for (const n of [200, 1000]) run(n, 25);

// 架子快满的时候才是用户真正担心的场景 ——
// "有些区被撑大、有些被挤掉、被挪到别处去"。有余量时谁都不用动。
console.log("\n———— 架子快满时 ————");
run(1000, 25, 0.95);
run(1000, 25, 0.99);

console.log(failed ? `\n=== ${failed} 项不合格 ===\n` : "\n=== 增量稳定性达标 ===\n");
process.exit(failed ? 1 : 0);
