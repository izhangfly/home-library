// 整屋搬动的执行与撤销 —— 路由和测试共用
//
// 这是这个应用里破坏性最大的操作：一次能搬几十上百本书。
// 它唯一的后悔药是撤销，而撤销本身**从来没被测过** ——
// CLAUDE.md 里记着它一度是假的：界面上写着"执行后可一键撤销"，
// 而整屋规划那条路压根没接住 batchId，那句话当时就是句谎话。
//
// 抽出来是为了能直接测（scripts/verify-concurrency.mts 的 D、E 两段）。
import type { Prisma } from "../app/generated/prisma/client";
import { prisma } from "./prisma";
import { refreshBookDerived } from "./books";

export interface Move {
  bookId: string;
  toLevelId: string;
}

interface Entry {
  bookId: string;
  from: string | null;
  /** 搬走之前在原层的第几位 —— 撤销要把这个也还回去 */
  fromOrder: number | null;
  to: string;
}

/** 只留最近这么多批，免得 Setting 表越长越大 */
const KEEP_BATCHES = 20;

export async function applyMoves(moves: Move[], note?: string | null) {
  const before = await prisma.placement.findMany({
    where: { bookId: { in: moves.map((m) => m.bookId) } },
    select: { bookId: true, levelId: true, orderInLevel: true },
  });
  const prev = new Map(before.map((p) => [p.bookId, p]));

  const batchId = `mv_${Date.now().toString(36)}`;
  const payload = {
    at: new Date().toISOString(),
    note: note ?? null,
    entries: moves.map<Entry>((m) => ({
      bookId: m.bookId,
      from: prev.get(m.bookId)?.levelId ?? null,
      // 以前只记了 from，没记位置。于是撤销只能把书放回原来那层，
      // 放在第几位全凭运气 —— 那不叫还原，叫"大概放回去了"。
      fromOrder: prev.get(m.bookId)?.orderInLevel ?? null,
      to: m.toLevelId,
    })),
    // Prisma 的 InputJsonValue 要求带索引签名，具名 interface 过不去。
    // 这里的形状是自己定的、也只有自己读（undoBatch），转一下是安全的。
  } as unknown as Prisma.InputJsonObject;

  await prisma.$transaction(async (tx) => {
    // 每个目标层单独算下一个序号。
    // 原来这里 create 不给 orderInLevel（走 schema 默认值 0）、
    // update 则原样保留**上一层**的序号 —— 一次整屋搬动就能把
    // 沿途每一层的先后全搅乱，而货架带和插入算法全靠这个顺序。
    const nextByLevel = new Map<string, number>();
    for (const m of moves) {
      if (!nextByLevel.has(m.toLevelId)) {
        const agg = await tx.placement.aggregate({
          where: { levelId: m.toLevelId, bookId: { notIn: moves.map((x) => x.bookId) } },
          _max: { orderInLevel: true },
        });
        nextByLevel.set(m.toLevelId, (agg._max.orderInLevel ?? -1) + 1);
      }
      const orderInLevel = nextByLevel.get(m.toLevelId)!;
      nextByLevel.set(m.toLevelId, orderInLevel + 1);

      await tx.placement.upsert({
        where: { bookId: m.bookId },
        create: { bookId: m.bookId, levelId: m.toLevelId, orderInLevel, confirmedByUser: true },
        update: { levelId: m.toLevelId, orderInLevel, confirmedByUser: true, placedAt: new Date() },
      });
    }

    await tx.setting.upsert({
      where: { key: `moveBatch.${batchId}` },
      create: { key: `moveBatch.${batchId}`, value: payload },
      // 不能写成 `update: { value: {} }`：batchId 是毫秒时间戳，同一毫秒内
      // 连按两次就会撞上，那一下会把撤销记录清成空对象 ——
      // 后悔药还在瓶子里，但瓶子空了。
      update: { value: payload },
    });
  });

  const stale = await prisma.setting.findMany({
    where: { key: { startsWith: "moveBatch." } },
    orderBy: { updatedAt: "desc" },
    skip: KEEP_BATCHES,
    select: { key: true },
  });
  if (stale.length) await prisma.setting.deleteMany({ where: { key: { in: stale.map((s) => s.key) } } });

  await Promise.all(moves.map((m) => refreshBookDerived(m.bookId)));
  return { moved: moves.length, batchId };
}

export class BatchNotFound extends Error {}

export async function undoBatch(batchId: string): Promise<{ reverted: number; skipped: number }> {
  const row = await prisma.setting.findUnique({ where: { key: `moveBatch.${batchId}` } });
  if (!row) throw new BatchNotFound();

  const { entries } = row.value as unknown as { entries: Entry[] };

  // 原来那一层可能已经被用户拆掉了。
  // 以前是整批一个事务无脑写回去，撞上外键就**整批失败** ——
  // 拆掉一层，之前所有批次的后悔药一起作废。
  // 现在先查哪些层还在：还得回去的还回去，回不去的跳过并如实报数。
  const wantLevels = [...new Set(entries.map((e) => e.from).filter(Boolean) as string[])];
  const live = new Set(
    (await prisma.level.findMany({ where: { id: { in: wantLevels } }, select: { id: true } })).map((l) => l.id),
  );

  const doable = entries.filter((e) => !e.from || live.has(e.from));
  const skipped = entries.length - doable.length;

  await prisma.$transaction(
    doable.map((e) =>
      e.from
        ? prisma.placement.upsert({
            where: { bookId: e.bookId },
            create: { bookId: e.bookId, levelId: e.from, orderInLevel: e.fromOrder ?? 0, confirmedByUser: true },
            // 位置也要还原。只还 levelId 的话，撤销之后那一层的先后仍是搬动时排的，
            // 等于没撤干净。
            update: { levelId: e.from, orderInLevel: e.fromOrder ?? 0 },
          })
        : prisma.placement.deleteMany({ where: { bookId: e.bookId } }),
    ),
  );

  // 全部还原了才删撤销记录。有跳过的就留着 ——
  // 万一用户把那一层又建回来，还能再撤一次。
  if (!skipped) await prisma.setting.delete({ where: { key: `moveBatch.${batchId}` } });

  await Promise.all(doable.map((e) => refreshBookDerived(e.bookId)));
  return { reverted: doable.length, skipped };
}
