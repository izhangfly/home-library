// 并发写入的性质测试 —— 两个人同时扫码会不会把书架撑爆
//
// 这个应用**从设计上就是多人同时用的**（"妹妹拿手机扫码"），
// 可容量判定这一路一直只按单线程验过：
//   读占用 → checkFit → 写 placement
// 三步之间没有事务、没有锁。两个人同时往同一层放书，
// 两边读到的是同一份占用，都算出"放得下"，然后都写进去 ——
// 那道 spec 硬性要求的 409 确认，就这么被并发绕过去了。
//
// 跑法：npx tsx scripts/verify-concurrency.mts
//   需要 DATABASE_URL 指向 **dev 库**（不是线上库），脚本会自己造数据再清掉。
import "dotenv/config";
import { prisma } from "../lib/prisma.ts";

// 这个测试要真的往库里写，所以**只认 dev/test 库**。
// 指着线上库就直接退出 —— 宁可不跑，也不能在用户的数据上造 8 本假书。
const url = process.env.DATABASE_URL ?? "";
if (!/_dev|_test/.test(url)) {
  console.log("\n=== 并发写入 ===");
  console.log("  · DATABASE_URL 不是 dev/test 库，跳过（这个测试要真写数据）\n");
  process.exit(0);
}

// 连不上就跳过而不是失败：dev 库要走 SSH 隧道，不是每台机器、每个时候都开着。
// 跳过要**说出来**，别让人以为跑过了。
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  console.log("\n=== 并发写入 ===");
  console.log(`  · 连不上 dev 库，跳过。要跑先开隧道：`);
  console.log(`    ssh -f -N -L 15432:127.0.0.1:5432 root@YOUR_SERVER_IP\n`);
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  —— " + detail : ""}`);
  ok ? pass++ : fail++;
};

const TAG = "__conc_test__";

async function cleanup() {
  await prisma.placement.deleteMany({ where: { book: { title: { startsWith: TAG } } } });
  await prisma.book.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { bookcase: { name: TAG } } });
  await prisma.bookcase.deleteMany({ where: { name: TAG } });
}

async function seed(levelWidthMm: number, nBooks: number, spineMm: number) {
  await cleanup();
  const bc = await prisma.bookcase.create({ data: { name: TAG, sortKey: 9999 } });
  const level = await prisma.level.create({
    data: { bookcaseId: bc.id, levelIndex: 1, widthMm: levelWidthMm, heightMm: 300, depthMm: 280 },
  });
  const books = [];
  for (let i = 0; i < nBooks; i++) {
    books.push(await prisma.book.create({
      data: {
        title: `${TAG}${i}`, authors: [], spineMm, heightMm: 200,
        clc: "I247", callNumber: `I247 T${i}`, callSortKey: `I247/${i}`,
      },
    }));
  }
  return { level, books };
}

console.log("\n=== 并发写入 ===\n");

// ---- A. 容量：一层只放得下 N 本，同时来 N+3 个请求
{
  const spine = 30, cap = 5;
  // 净宽刚好够 5 本，多一本就超
  const { level, books } = await seed(spine * cap + 5, cap + 3, spine);

  const { placeOne } = await import("../lib/placeService.ts").catch(() => ({ placeOne: null as never }));
  if (!placeOne) {
    console.log("  （lib/placeService.ts 还不存在 —— 这正是本轮要加的东西）");
  }

  await Promise.all(books.map((b) => placeOne({ bookId: b.id, levelId: level.id }).catch(() => null)));

  const placed = await prisma.placement.count({ where: { levelId: level.id } });
  const used = placed * spine;
  check(`同时放 ${books.length} 本、只装得下 ${cap} 本时不超装`, placed <= cap,
    `实际放进去 ${placed} 本（占 ${used}mm / 净宽 ${spine * cap + 5}mm）`);

  // ---- B. orderInLevel 不能重复：它决定架上的先后
  const orders = (await prisma.placement.findMany({
    where: { levelId: level.id }, select: { orderInLevel: true },
  })).map((p) => p.orderInLevel);
  check("orderInLevel 没有重复（它决定架上的先后）",
    new Set(orders).size === orders.length, `${orders.sort((a, b) => a - b).join(",")}`);
}

// ---- C. 盘点扫码这条路也要算对 orderInLevel
//
// 盘点**故意**不判容量（书已经物理在架上了，这时说"放不下"没意义），
// 但顺序必须算对。原来这条路直接 upsert，orderInLevel 走 schema 默认值 0：
// 每本扫进来的新书都是 0，从别层挪过来的则原样保留旧层的号。
{
  const { recordScanned } = await import("../lib/placeService.ts");
  const { level, books } = await seed(2000, 5, 30);

  // 先把一本放到"别的层"，模拟错架 —— 它挪过来时不能带着旧号
  const other = await prisma.level.create({
    data: { bookcaseId: level.bookcaseId, levelIndex: 2, widthMm: 2000, heightMm: 300, depthMm: 280 },
  });
  await prisma.placement.create({ data: { bookId: books[0].id, levelId: other.id, orderInLevel: 7 } });

  for (const b of books) await recordScanned(b.id, level.id);

  const orders = (await prisma.placement.findMany({
    where: { levelId: level.id }, orderBy: { orderInLevel: "asc" }, select: { orderInLevel: true },
  })).map((p) => p.orderInLevel);
  // 断言"恰好是 0..n-1"而不是"没有重复"：
  // 第一版写的是"不重复"，结果坏代码产出 0,0,0,0,7 时那条**也过了**
  // （7 只出现一次）。弱断言比没断言更糟 —— 它会让人以为查过了。
  const want = books.map((_, i) => i).join(",");
  check("盘点后整层顺序是连续的 0..n-1", orders.join(",") === want, `${orders.join(",")}（应为 ${want}）`);

  // 同一本重复扫不该把它挪到队尾
  const before = (await prisma.placement.findUnique({ where: { bookId: books[1].id } }))!.orderInLevel;
  await recordScanned(books[1].id, level.id);
  const after = (await prisma.placement.findUnique({ where: { bookId: books[1].id } }))!.orderInLevel;
  check("同一本重复扫，位置不动", before === after, `${before} → ${after}`);
}

// ---- D. 整屋搬动的撤销要真的能还原
//
// 撤销是这个应用里**破坏性最大**的操作（一次搬几十上百本）唯一的后悔药，
// 可它自己从来没被测过。CLAUDE.md 里记着它一度是假的：
// 界面上写着"执行后可一键撤销"，而那条路压根没接住 batchId。
{
  const { applyMoves, undoBatch } = await import("../lib/reflowService.ts");
  const { level, books } = await seed(3000, 4, 30);
  const other = await prisma.level.create({
    data: { bookcaseId: level.bookcaseId, levelIndex: 2, widthMm: 3000, heightMm: 300, depthMm: 280 },
  });

  for (let i = 0; i < books.length; i++) {
    await prisma.placement.create({ data: { bookId: books[i].id, levelId: level.id, orderInLevel: i } });
  }
  const snapshot = async (lv: string) =>
    (await prisma.placement.findMany({ where: { levelId: lv }, orderBy: { orderInLevel: "asc" },
      select: { bookId: true, orderInLevel: true } }))
      .map((p) => `${p.bookId.slice(-4)}@${p.orderInLevel}`).join(" ");

  const wasLevel = await snapshot(level.id);

  const { batchId } = await applyMoves([
    { bookId: books[2].id, toLevelId: other.id },
    { bookId: books[3].id, toLevelId: other.id },
  ]);

  const movedOrders = (await prisma.placement.findMany({
    where: { levelId: other.id }, select: { orderInLevel: true },
  })).map((p) => p.orderInLevel).sort();
  check("搬过去之后目标层的序号不重复", new Set(movedOrders).size === movedOrders.length,
    movedOrders.join(","));

  await undoBatch(batchId);
  const nowLevel = await snapshot(level.id);
  check("撤销后原样还原（层 + 序号）", nowLevel === wasLevel, `撤销后「${nowLevel}」原本「${wasLevel}」`);
  check("撤销后目标层清空", (await prisma.placement.count({ where: { levelId: other.id } })) === 0);
}

// ---- E. 撤销时原来那一层已经被删了，不能整批失败
{
  const { applyMoves, undoBatch } = await import("../lib/reflowService.ts");
  const { level, books } = await seed(3000, 2, 30);
  const doomed = await prisma.level.create({
    data: { bookcaseId: level.bookcaseId, levelIndex: 3, widthMm: 3000, heightMm: 300, depthMm: 280 },
  });
  await prisma.placement.create({ data: { bookId: books[0].id, levelId: doomed.id, orderInLevel: 0 } });
  await prisma.placement.create({ data: { bookId: books[1].id, levelId: level.id, orderInLevel: 0 } });

  const { batchId } = await applyMoves([
    { bookId: books[0].id, toLevelId: level.id },
    { bookId: books[1].id, toLevelId: level.id },
  ]);
  await prisma.placement.deleteMany({ where: { levelId: doomed.id } });
  await prisma.level.delete({ where: { id: doomed.id } });

  let threw = false;
  let result: { reverted: number; skipped: number } | null = null;
  try { result = await undoBatch(batchId); } catch { threw = true; }
  check("原层没了也不整批失败", !threw, "抛异常了，等于后悔药作废");
  check("能还原的还是还原了，跳过的要报出来",
    !!result && result.reverted >= 1 && result.skipped >= 1, JSON.stringify(result));
}

// ---- F. 删柜子/删层之前要知道自己在删什么
//
// 级联是 Bookcase → Level → Placement，删一个柜子会静默抹掉它上面
// 所有书的上架关系（书本身保留）。这个应用为了**一本**书放进快满的层
// 都会返回 409 让人确认，删几百本的位置却一道服务端拦截都没有，
// 界面上那句提示还不带数字 —— 0 本和 200 本长得一模一样。
{
  const { level, books } = await seed(3000, 3, 30);
  for (let i = 0; i < books.length; i++) {
    await prisma.placement.create({ data: { bookId: books[i].id, levelId: level.id, orderInLevel: i } });
  }
  const countOnBookcase = await prisma.placement.count({ where: { level: { bookcaseId: level.bookcaseId } } });
  check("能数出柜子上有多少本书（409 要带这个数）", countOnBookcase === books.length,
    `${countOnBookcase} vs ${books.length}`);

  // 删层之后书还在，只是没上架了 —— 这是"可恢复"和"丢数据"的分界线
  await prisma.level.delete({ where: { id: level.id } });
  const survived = await prisma.book.count({ where: { title: { startsWith: TAG } } });
  const stillPlaced = await prisma.placement.count({ where: { bookId: { in: books.map((b) => b.id) } } });
  check("删层之后书本身一本都没少", survived === books.length, `${survived}/${books.length}`);
  check("上架关系随层一起没了（所以才必须先问清楚）", stillPlaced === 0, `还剩 ${stillPlaced}`);
}

await cleanup();
await prisma.$disconnect();
console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
