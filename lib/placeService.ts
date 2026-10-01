// 上架这件事本身 —— 路由和测试共用
//
// 从 app/api/placements/route.ts 抽出来，原因有二：
//   1. 并发性质测试要能直接调它，不必绕 HTTP
//   2. "读占用 → 判容量 → 写" 这三步必须在**一个事务**里，
//      而事务的边界属于业务逻辑，不属于路由
import { prisma } from "./prisma";
import { refreshBookDerived } from "./books";
import { checkFit } from "./capacity";
import { getCoefficients } from "./settings";
import { loadBookForCapacity, loadShelfState } from "./shelfState";

export interface PlaceInput {
  bookId: string;
  levelId: string;
  confirmedByUser?: boolean;
  isNearFull?: boolean;
  force?: boolean;
}

/** 业务上的拒绝（不是异常）。路由把它翻成 409/404。 */
export class PlaceRejected extends Error {
  constructor(readonly code: "book_not_found" | "level_not_found" | "too_tall" | "needs_confirmation",
              readonly status: number, readonly fit?: unknown) {
    super(code);
  }
}

/**
 * 放一本书上架。
 *
 * **整段在一个事务里，而且第一件事是锁住目标层。**
 *
 * 原来是"读占用 → 判容量 → 写"三步裸着跑的。两个人同时往同一层放书，
 * 两边读到同一份占用，都算出放得下，都写进去。实测（scripts/verify-concurrency.mts）：
 * 一层只装得下 5 本，同时发 8 个请求，8 本全进去了 —— 240mm 的书塞进 155mm 的层，
 * 撑到 155%。那道 spec 硬性要求的 409 确认，并发之下等于不存在。
 * orderInLevel 更直白：8 本全拿到 0，架上的先后彻底没了。
 *
 * 锁**这一层**而不是整张表：同时往不同层放书是家里的常态（两个人在两个房间），
 * 那些请求本来就不冲突，没必要互相等。冲突只发生在同一层上。
 */
/**
 * 在一层里算出下一个 orderInLevel。**必须在已经锁住该层的事务里调用。**
 *
 * 用 max+1 而不是"现有本数"：书被取下之后 order 会出现空洞，
 * 拿本数当下一个号会撞上一个已经存在的号。
 */
async function nextOrder(tx: Tx, levelId: string, exceptBookId: string): Promise<number> {
  const agg = await tx.placement.aggregate({
    where: { levelId, NOT: { bookId: exceptBookId } },
    _max: { orderInLevel: true },
  });
  return (agg._max.orderInLevel ?? -1) + 1;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * 盘点时扫到一本书 —— 记录**现实**，不做容量判定。
 *
 * 为什么单独一个函数而不是给 placeOne 加个 `skipCapacity` 开关：
 * 那个开关会变成第二个 `force: true`。CLAUDE.md 里已经记着一次教训 ——
 * 客户端带一个 force 就把两道 409 全废了，而那行代码看起来无比合理。
 * 一个叫 `recordScanned` 的函数没法被误当成"上架"用。
 *
 * 这里**故意**不判容量：盘点是拿着书站在架前一本本扫，
 * 书已经物理地在那层上了。这时候跳出来说"放不下"毫无意义 ——
 * 系统该做的是承认现实，容量超了自然会在理架页面上显示为溢出。
 *
 * 但**顺序必须算对**。原来这条路直接 upsert，`orderInLevel` 走 schema 默认值 0：
 * 每一本扫进来的新书都是 0；从别层挪过来的书则原样保留旧层的号
 * （在 A 层第 7 位的书，挪到 B 层还叫第 7 位）。整层的先后就此作废，
 * 而货架带和插入算法全靠这个顺序。
 */
export async function recordScanned(bookId: string, levelId: string) {
  const placement = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Level" WHERE id = ${levelId} FOR UPDATE
    `;
    if (!locked.length) throw new PlaceRejected("level_not_found", 404);

    const existing = await tx.placement.findUnique({ where: { bookId } });
    // 本来就在这层：位置不动，只更新确认时间。重排会让盘点顺序污染架上顺序。
    const orderInLevel = existing?.levelId === levelId
      ? existing.orderInLevel
      : await nextOrder(tx, levelId, bookId);

    return tx.placement.upsert({
      where: { bookId },
      create: { bookId, levelId, orderInLevel, confirmedByUser: true },
      update: { levelId, orderInLevel, confirmedByUser: true, placedAt: new Date() },
    });
  });
  await refreshBookDerived(bookId);
  return placement;
}

export async function placeOne(input: PlaceInput) {
  const coeffs = await getCoefficients();

  return await prisma.$transaction(async (tx) => {
    // 先上锁再读。反过来（先读后锁）等于没锁 —— 读到的仍是别人写之前的快照。
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Level" WHERE id = ${input.levelId} FOR UPDATE
    `;
    if (!locked.length) throw new PlaceRejected("level_not_found", 404);

    // 事务客户端只有一条连接，两个查询不能并发发出去
    // （pg 会警告 "client is already executing a query"，pg@9 起直接不允许）。
    const book = await loadBookForCapacity(input.bookId, tx);
    const state = await loadShelfState(tx);
    if (!book) throw new PlaceRejected("book_not_found", 404);

    const level = state.levels.find((l) => l.id === input.levelId);
    if (!level) throw new PlaceRejected("level_not_found", 404);

    const existing = (state.occupancy.get(level.id) ?? []).filter((b) => b.id !== book.id);
    const fit = checkFit(book, level, existing, coeffs);

    if (fit.height === "too_tall" && !input.force) throw new PlaceRejected("too_tall", 409, fit);
    if (fit.needsManualConfirm && !input.confirmedByUser && !input.force) {
      throw new PlaceRejected("needs_confirmation", 409, fit);
    }

    const orderInLevel = await nextOrder(tx, input.levelId, input.bookId);

    const placement = await tx.placement.upsert({
    where: { bookId: input.bookId },
    create: {
      bookId: input.bookId, levelId: input.levelId, orderInLevel,
      confirmedByUser: input.confirmedByUser ?? false,
      isNearFull: input.isNearFull ?? false,
    },
    update: {
      levelId: input.levelId, orderInLevel,
      confirmedByUser: input.confirmedByUser ?? false,
      isNearFull: input.isNearFull ?? false,
      placedAt: new Date(),
    },
  });

    return { placement, fit };
  }).then(async (r) => {
    // 派生字段刷新放在事务外：它只读自己这本书，不参与容量判定，
    // 放进去只会把锁的持有时间拉长。
    await refreshBookDerived(input.bookId);
    return r;
  });
}
