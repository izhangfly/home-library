// 初始化数据。
//   npm run seed          只建默认标签（新装机器跑这个就够）
//   npm run seed -- --demo 额外造两个书柜 + 几本真书，用来验证容量/地图/检索
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { createBook } from "../lib/books";
import { parseBarcode } from "../lib/isbn";
import { lookupByIsbn } from "../lib/providers";

const DEFAULT_TAGS: { name: string; nameEn: string; color: string }[] = [
  // 标签**不再重复分类**。"小说/历史/科普"这些默认标签就是中图法的劣化版：
  // 分类号是自动算出来的、覆盖每一本、还能排序，标签是手打的、大部分书没有。
  // 两套并存的结果是同一件事有两个互相打架的答案。
  // 现在默认标签只放分类法表达不了的东西 —— 书的**状态和来历**。
  { name: "待读", nameEn: "To read", color: "#FDC800" },
  { name: "在读", nameEn: "Reading", color: "#16A34A" },
  { name: "已读", nameEn: "Read", color: "#0EA5E9" },
  { name: "借出", nameEn: "Lent out", color: "#DC2626" },
  { name: "签名本", nameEn: "Signed", color: "#7C3AED" },
  { name: "常翻", nameEn: "Often used", color: "#F97316" },
];

async function seedTags() {
  for (const [i, tag] of DEFAULT_TAGS.entries()) {
    await prisma.tag.upsert({
      where: { name: tag.name },
      create: { ...tag, sortKey: i },
      update: {},
    });
  }
  console.log(`标签: ${DEFAULT_TAGS.length} 个已就绪`);
}

async function seedDemo() {
  // 书柜尺寸取常见的宜家 BILLY：宽 800、层净空 ~360/260、深 280
  const living = await prisma.bookcase.create({
    data: {
      name: "客厅大书柜",
      room: "客厅",
      roomX: 0,
      roomY: 0,
      sortKey: 0,
      levels: {
        create: [
          { levelIndex: 1, widthMm: 760, heightMm: 360, depthMm: 280, note: "最下层，放大开本" },
          { levelIndex: 2, widthMm: 760, heightMm: 260, depthMm: 280 },
          { levelIndex: 3, widthMm: 760, heightMm: 260, depthMm: 280 },
          // 妹妹 140cm，够得着的高度大约到第 3 层；第 4 层以上给大人
          { levelIndex: 4, widthMm: 760, heightMm: 260, depthMm: 280 },
        ],
      },
    },
    include: { levels: true },
  });

  const study = await prisma.bookcase.create({
    data: {
      name: "书房矮柜",
      room: "书房",
      roomX: 1,
      roomY: 0,
      sortKey: 1,
      levels: {
        create: [
          { levelIndex: 1, widthMm: 600, heightMm: 300, depthMm: 260, note: "妹妹够得着" },
          { levelIndex: 2, widthMm: 600, heightMm: 300, depthMm: 260 },
        ],
      },
    },
    include: { levels: true },
  });

  console.log(`书柜: ${living.name}(${living.levels.length}层), ${study.name}(${study.levels.length}层)`);

  // 用真实 ISBN 走一遍完整的查询→入库链路
  const isbns = ["9787536692930", "9787506365437", "9787559819918", "9780062316097", "9780140449136"];

  const levels = [...living.levels, ...study.levels];
  let placed = 0;

  for (const isbn of isbns) {
    const parsed = parseBarcode(isbn);
    if (!parsed.isbn13) continue;

    const exists = await prisma.book.findUnique({ where: { isbn13: parsed.isbn13 } });
    if (exists) {
      console.log(`  跳过（已存在）: ${exists.title}`);
      continue;
    }

    const lookup = await lookupByIsbn(parsed.isbn13, parsed.isbn10);
    const m = lookup.merged;
    if (!m.title) {
      console.log(`  查不到: ${isbn}`);
      continue;
    }

    // 不打标签。分类交给中图法（createBook 里会算），标签留给人工标状态。
    const book = await createBook({
      isbn13: parsed.isbn13,
      isbn10: parsed.isbn10 ?? null,
      title: m.title,
      subtitle: m.subtitle ?? null,
      authors: m.authors ?? [],
      translators: m.translators ?? [],
      publisher: m.publisher ?? null,
      pubDate: m.pubDate ?? null,
      language: m.language ?? null,
      pageCount: m.pageCount ?? null,
      binding: m.binding ?? null,
      price: m.price ?? null,
      summary: m.summary ?? null,
      coverUrl: m.coverUrl ?? null,
      sourceMeta: lookup.sourceMeta,
      // 主题词一并入库 —— DDC 重算时全靠它
      subjects: m.subjects ?? [],
      authoritativeDdc: m.ddc ?? null,
    });

    // 轮流放到不同层，好让地图和容量条上有东西可看
    const level = levels[placed % levels.length];
    await prisma.placement.create({
      data: { bookId: book.id, levelId: level.id, orderInLevel: placed, confirmedByUser: true },
    });
    placed++;
    console.log(`  入库: ${book.title} → ${level.levelIndex} 层`);
  }

  console.log(`共入库 ${placed} 本`);
}

await seedTags();
if (process.argv.includes("--demo")) await seedDemo();
await prisma.$disconnect();
