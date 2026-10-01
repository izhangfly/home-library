// 标签空间压力 + 迁移建议 —— F3 的动态部分
import { estimateSpine, findFreeLevels, tagPressure } from "@/lib/capacity";
import { getCoefficients } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { loadShelfState } from "@/lib/shelfState";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  const [tags, state, coeffs] = await Promise.all([
    prisma.tag.findMany({
      include: {
        books: {
          include: {
            book: {
              select: {
                id: true, spineMm: true, pageCount: true, binding: true, heightMm: true,
              },
            },
          },
        },
      },
    }),
    loadShelfState(),
    getCoefficients(),
  ]);

  const levelById = new Map(state.levels.map((l) => [l.id, l]));

  const report = tags.map((tag) => {
    const books = tag.books.map((bt) => ({ ...bt.book, tagNames: [tag.name] }));
    const zoneLevelIds = state.tagZones.get(tag.id) ?? [];
    const zoneLevels = zoneLevelIds
      .map((id) => levelById.get(id))
      .filter((l): l is NonNullable<typeof l> => !!l);

    const pressure = tagPressure(tag, books, zoneLevels, coeffs);

    // 只有真的溢出了才去找空层，省得每次都算一遍
    let freeLevels: { levelId: string; bookcaseName: string; levelIndex: number; remainingMm: number }[] = [];
    if (pressure.status === "overflow") {
      // 迁移整个标签，需要的宽度是这批书的总宽；层高要能装下最高的一本
      const maxHeight = Math.max(0, ...books.map((b) => b.heightMm ?? 0));
      freeLevels = findFreeLevels(
        pressure.totalSpineMm,
        state.levels.filter((l) => !zoneLevelIds.includes(l.id)),
        state.occupancy,
        maxHeight,
        coeffs,
      ).map((r) => ({
        levelId: r.level.id,
        bookcaseName: r.level.bookcaseName,
        levelIndex: r.level.levelIndex,
        remainingMm: r.usage.remainingMm,
      }));
    }

    return {
      ...pressure,
      color: tag.color,
      bookCount: books.length,
      zoneLevels: zoneLevels.map((l) => ({
        id: l.id,
        bookcaseName: l.bookcaseName,
        levelIndex: l.levelIndex,
        widthMm: l.widthMm,
      })),
      freeLevels,
      // 该标签里厚度靠猜的书越多，上面的数字越不可信
      estimatedCount: books.filter((b) => estimateSpine(b, coeffs).source !== "measured").length,
    };
  });

  return ok({ pressure: report });
});
