// 把「所有层 + 每层现有书 + 标签分区」一次性读出来。
// 容量计算是全局的（一层的剩余空间取决于该层所有书），
// 每个调用点各自查一遍必然会出现口径不一致，所以统一在这里取。
import { prisma } from "./prisma";
import type { LevelLike, PlacedBookLike } from "./capacity";

/**
 * 可以传事务客户端进来。
 *
 * 上架那条路必须在**一个事务里**先锁住目标层再读占用，否则两个人同时放书，
 * 两边读到同一份占用、都算出"放得下"、都写进去 —— 实测能把只装得下 5 本的
 * 一层塞进 8 本（240mm 的书塞进 155mm）。读如果不走事务客户端，
 * 锁就白加了：锁在事务里，读在事务外，读到的还是旧的。
 */
type Db = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface ShelfState {
  levels: (LevelLike & { bookcaseName: string; room: string | null })[];
  occupancy: Map<string, PlacedBookLike[]>;
  tagZones: Map<string, string[]>;
}

export async function loadShelfState(db: Db = prisma): Promise<ShelfState> {
  const [levelRows, zoneRows] = await Promise.all([
    db.level.findMany({
      orderBy: [{ bookcase: { sortKey: "asc" } }, { levelIndex: "asc" }],
      include: {
        bookcase: { select: { name: true, room: true } },
        placements: {
          include: {
            book: {
              select: {
                id: true, spineMm: true, pageCount: true, binding: true, heightMm: true,
                tags: { select: { tag: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }),
    db.tagZone.findMany(),
  ]);

  const levels = levelRows.map((l) => ({
    id: l.id,
    levelIndex: l.levelIndex,
    widthMm: l.widthMm,
    heightMm: l.heightMm,
    depthMm: l.depthMm,
    bookcaseId: l.bookcaseId,
    bookcaseName: l.bookcase.name,
    room: l.bookcase.room,
  }));

  const occupancy = new Map<string, PlacedBookLike[]>();
  for (const level of levelRows) {
    occupancy.set(
      level.id,
      level.placements.map((p) => ({
        id: p.book.id,
        spineMm: p.book.spineMm,
        pageCount: p.book.pageCount,
        binding: p.book.binding,
        heightMm: p.book.heightMm,
        tagNames: p.book.tags.map((t) => t.tag.name),
      })),
    );
  }

  const tagZones = new Map<string, string[]>();
  for (const zone of zoneRows) {
    tagZones.set(zone.tagId, [...(tagZones.get(zone.tagId) ?? []), zone.levelId]);
  }

  return { levels, occupancy, tagZones };
}

export async function loadBookForCapacity(bookId: string, db: Db = prisma) {
  const book = await db.book.findUnique({
    where: { id: bookId },
    select: {
      id: true, title: true, spineMm: true, pageCount: true, binding: true, heightMm: true,
      tags: { select: { tagId: true, tag: { select: { name: true } } } },
    },
  });
  if (!book) return null;

  return {
    id: book.id,
    title: book.title,
    spineMm: book.spineMm,
    pageCount: book.pageCount,
    binding: book.binding,
    heightMm: book.heightMm,
    tagIds: book.tags.map((t) => t.tagId),
    tagNames: book.tags.map((t) => t.tag.name),
  };
}
