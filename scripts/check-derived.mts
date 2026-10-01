// 派生字段体检 —— 书架界的 fsck
//
// Book 上有四个字段是**算出来的**，不是录进来的：
//   callSortKey  索书号排序键 —— 上架算法整条货架带的顺序全靠它
//   callNumber   索书号
//   searchIndex  原文 + 全拼 + 首字母，搜索靠它
//   completeness 元数据完整度
//
// 它们只在写入路径上被刷新。哪条路径漏了刷新，数据就会**静默**漂移：
// callSortKey 一旦和分类号对不上，那本书在货架带上的位置就是错的，
// 于是「按索书号该放这儿」给出错误答案，而界面上一切看起来都正常 ——
// 分类号显示得好好的，只有藏在后面的排序键是旧的。
//
// 这个脚本只读，随时可跑：
//   npx tsx scripts/check-derived.mts            报告漂移
//   npx tsx scripts/check-derived.mts --fix      顺手修好（会写库）

// 独立脚本不走 Next 的加载链，得自己读 .env（和 seed.mts 一样）
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { recomputeDerived } from "../lib/books";

const FIX = process.argv.includes("--fix");

const books = await prisma.book.findMany({
  include: { tags: true, placement: true },
  orderBy: { createdAt: "asc" },
});

interface Drift {
  id: string;
  title: string;
  field: string;
  stored: string;
  should: string;
}

const drifts: Drift[] = [];

for (const b of books) {
  const want = recomputeDerived({
    ...b,
    tagCount: b.tags.length,
    hasConfirmedPlacement: !!b.placement,
  });
  const cmp: [string, unknown, unknown][] = [
    ["callSortKey", b.callSortKey, want.callSortKey],
    ["callNumber", b.callNumber, want.callNumber],
    ["searchIndex", b.searchIndex, want.searchIndex],
    ["completeness", b.completeness, want.completeness],
  ];
  for (const [field, stored, should] of cmp) {
    if (String(stored ?? "") !== String(should ?? "")) {
      drifts.push({
        id: b.id,
        title: b.title,
        field,
        stored: String(stored ?? "").slice(0, 60),
        should: String(should ?? "").slice(0, 60),
      });
    }
  }
}

console.log(`\n检查了 ${books.length} 本书\n`);

// ---------------------------------------------------------------- 架上顺序
//
// orderInLevel 决定一层里书的先后，货架带和插入算法全靠它。
// 它**不是**用户填的，是系统算的 —— 所以和派生字段一样会漂，也一样该体检。
//
// 已经踩过的两个来源：
//   1. 盘点扫码那条路以前直接 upsert，走 schema 默认值 0 ——
//      每本扫进来的新书都是 0；从别层挪过来的则原样保留旧层的号
//      （线上真出现过：一本书独占一层，序号却是 4，那是它在老柜子里的位置）。
//   2. 并发上架时两边算出同一个号（已由 lib/placeService.ts 的层锁修掉）。
//
// 判据是"每层必须恰好是 0..n-1"：既不能重复，也不能有空洞 ——
// 空洞本身无害，但它是上面那类 bug 留下的脚印，值得被看见。
const levelsWithBooks = await prisma.level.findMany({
  where: { placements: { some: {} } },
  select: {
    id: true, levelIndex: true,
    bookcase: { select: { name: true } },
    placements: { select: { bookId: true, orderInLevel: true }, orderBy: { orderInLevel: "asc" } },
  },
});

const orderDrifts = levelsWithBooks.filter((l) =>
  l.placements.some((p, i) => p.orderInLevel !== i),
);

if (!orderDrifts.length) {
  console.log("✓ 每层的架上顺序都是连续的 0..n-1\n");
} else {
  console.log(`✗ ${orderDrifts.length} 层的架上顺序不连续：\n`);
  for (const l of orderDrifts) {
    console.log(`  ${l.bookcase.name} 第 ${l.levelIndex} 层：${l.placements.map((p) => p.orderInLevel).join(",")} → 应为 ${l.placements.map((_, i) => i).join(",")}`);
  }
  if (FIX) {
    let n = 0;
    for (const l of orderDrifts) {
      // 保持现有先后，只把号重新排成 0..n-1 —— 不改变任何一本书的相对位置
      await prisma.$transaction(
        l.placements.map((p, i) =>
          prisma.placement.update({ where: { bookId: p.bookId }, data: { orderInLevel: i } }),
        ),
      );
      n += l.placements.length;
    }
    console.log(`\n已重排 ${n} 条上架记录的序号（相对先后不变）`);
  } else {
    console.log("\n（只读检查。加 --fix 可以顺手修好）");
  }
  console.log();
}

if (!drifts.length) {
  console.log("✓ 派生字段全部与源数据一致\n");
} else {
  // callSortKey 最要命：它决定书在货架带上的位置，错了就会给出错误的上架建议
  const bySeverity = { callSortKey: 0, callNumber: 1, completeness: 2, searchIndex: 3 } as Record<string, number>;
  drifts.sort((a, b) => (bySeverity[a.field] ?? 9) - (bySeverity[b.field] ?? 9));

  console.log(`✗ 发现 ${drifts.length} 处漂移：\n`);
  for (const d of drifts) {
    const mark = d.field === "callSortKey" ? "  ⚠ 会导致上架位置算错" : "";
    console.log(`  ${d.title}`);
    console.log(`    ${d.field}: 库里「${d.stored}」→ 应为「${d.should}」${mark}`);
  }

  if (FIX) {
    console.log("\n正在修复…");
    let fixed = 0;
    for (const id of new Set(drifts.map((d) => d.id))) {
      const b = books.find((x) => x.id === id)!;
      const want = recomputeDerived({
        ...b,
        tagCount: b.tags.length,
        hasConfirmedPlacement: !!b.placement,
      });
      await prisma.book.update({ where: { id }, data: want });
      fixed++;
    }
    console.log(`已修复 ${fixed} 本书的派生字段`);
  } else {
    console.log("\n（只读检查。加 --fix 可以顺手修好）");
  }
}

process.exit((drifts.length || orderDrifts.length) && !FIX ? 1 : 0);
