// 把整屋布局规划需要的数据一次性读出来。
//
// 和 lib/shelfLoad.ts 的区别：那份是给"单本上架/单层重排"用的扁平层列表，
// 这份是给 lib/layout.ts 用的树（房间 → 书柜 → 层），因为柜级 DP 要按柜子分段，
// 距离计算还要用到房间归属。
import { prisma } from "./prisma";
import type { LayoutBook, LayoutBookcase } from "./layout";

const BOARD_MM = 20;

export async function loadLayoutWorld(): Promise<{
  bookcases: LayoutBookcase[];
  books: LayoutBook[];
}> {
  const [rows, books] = await Promise.all([
    prisma.bookcase.findMany({
      orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }],
      include: {
        levels: { orderBy: { levelIndex: "asc" } },
        roomRef: { select: { id: true, name: true } },
      },
    }),
    prisma.book.findMany({
      select: {
        id: true, title: true, clc: true, callSortKey: true,
        spineMm: true, pageCount: true, binding: true, heightMm: true,
        placement: { select: { levelId: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    }),
  ]);

  const bookcases: LayoutBookcase[] = rows.map((bc) => {
    // 从最底层往上累加，得到每层的离地高度 —— 可达性全靠它，不能只看 levelIndex
    let floor = BOARD_MM;
    const levels = bc.levels.map((l) => {
      const level = {
        id: l.id,
        bookcaseId: bc.id,
        levelIndex: l.levelIndex,
        widthMm: l.widthMm,
        heightMm: l.heightMm,
        floorMm: floor,
      };
      floor += l.heightMm + BOARD_MM;
      return level;
    });

    return {
      id: bc.id,
      name: bc.name,
      roomId: bc.roomRef?.id ?? bc.roomId ?? null,
      roomName: bc.roomRef?.name ?? bc.room ?? null,
      x: bc.roomX,
      y: bc.roomY,
      levels,
    };
  });

  return {
    bookcases,
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
      tagNames: b.tags.map((t) => t.tag.name),
    })),
  };
}
