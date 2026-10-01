// 清空书目与书架结构，保留标签和设置。
// 用途：演示数据玩完了要开始录真书，或者整理到一半想推倒重来。
//   npm run reset -- --yes
// 不加 --yes 只打印将要删除的数量，不动数据。
import "dotenv/config";
import { prisma } from "../lib/prisma";

const confirmed = process.argv.includes("--yes");

const [books, bookcases, levels, placements, tags] = await Promise.all([
  prisma.book.count(),
  prisma.bookcase.count(),
  prisma.level.count(),
  prisma.placement.count(),
  prisma.tag.count(),
]);

console.log(`将删除：书 ${books} 本、书柜 ${bookcases} 个、层 ${levels} 层、上架记录 ${placements} 条`);
console.log(`将保留：标签 ${tags} 个、设置`);

if (!confirmed) {
  console.log("\n这是预演。确认要删就加 --yes：npm run reset -- --yes");
  await prisma.$disconnect();
  process.exit(0);
}

// Placement / BookTag / TagZone / Level 都配了级联删除，
// 但显式按顺序删更好读，也不依赖 schema 的级联设置没被改过。
await prisma.placement.deleteMany({});
await prisma.tagZone.deleteMany({});
await prisma.bookTag.deleteMany({});
await prisma.book.deleteMany({});
await prisma.level.deleteMany({});
await prisma.bookcase.deleteMany({});

console.log(`\n已清空。标签保留 ${await prisma.tag.count()} 个。`);
await prisma.$disconnect();
