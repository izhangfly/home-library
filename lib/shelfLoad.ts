// 把上架引擎需要的数据从库里一次性读出来。
// 层的离地高度要按柜内各层累加算，不能只看 levelIndex。
import { prisma } from "./prisma";
import type { ShelfBook, ShelfLevel } from "./shelving";

const BOARD_MM = 20;

export async function loadShelfWorld(): Promise<{
  levels: ShelfLevel[];
  books: ShelfBook[];
}> {
  const [bookcases, books] = await Promise.all([
    prisma.bookcase.findMany({
      orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }],
      include: { levels: { orderBy: { levelIndex: "asc" } } },
    }),
    prisma.book.findMany({
      select: {
        id: true, title: true, clc: true, callSortKey: true,
        spineMm: true, pageCount: true, binding: true, heightMm: true,
        placement: { select: { levelId: true } },
      },
    }),
  ]);

  const levels: ShelfLevel[] = [];
  for (const bc of bookcases) {
    // 从最底层往上累加，得到每层的离地高度
    let floor = BOARD_MM;
    for (const l of bc.levels) {
      levels.push({
        id: l.id,
        bookcaseId: bc.id,
        bookcaseName: bc.name,
        roomName: bc.room,
        levelIndex: l.levelIndex,
        widthMm: l.widthMm,
        heightMm: l.heightMm,
        floorMm: floor,
        x: bc.roomX,
        y: bc.roomY,
      });
      floor += l.heightMm + BOARD_MM;
    }
  }

  return {
    levels,
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      clc: b.clc,
      callSortKey: b.callSortKey,
      spineMm: b.spineMm,
      pageCount: b.pageCount,
      binding: b.binding,
      heightMm: b.heightMm,
      levelId: b.placement?.levelId ?? null,
    })),
  };
}
