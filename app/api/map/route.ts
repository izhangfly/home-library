// 书架地图数据 —— F3 / F2 的可视化基础。
// 一次返回整棵树 + 每层容量，前端不用为每层再发一次请求。
import { estimateSpine, levelUsage } from "@/lib/capacity";
import { getCoefficients } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  const [bookcases, coeffs] = await Promise.all([
    prisma.bookcase.findMany({
      orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }],
      include: {
        levels: {
          orderBy: { levelIndex: "asc" },
          include: {
            tagZones: { include: { tag: true } },
            placements: {
              orderBy: { orderInLevel: "asc" },
              include: {
                book: {
                  select: {
                    id: true, title: true, authors: true, coverUrl: true, ddc: true, clc: true, callNumber: true,
                    spineMm: true, pageCount: true, binding: true, heightMm: true,
                    tags: { include: { tag: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    getCoefficients(),
  ]);

  const shaped = bookcases.map((bc) => ({
    id: bc.id,
    name: bc.name,
    room: bc.room,
    roomId: bc.roomId,
    roomX: bc.roomX,
    roomY: bc.roomY,
    rotation: bc.rotation,
    widthMm: bc.widthMm,
    depthMm: bc.depthMm,
    heightMm: bc.heightMm,
    color: bc.color,
    levels: bc.levels.map((level) => {
      const books = level.placements.map((p) => ({
        ...p.book,
        tagNames: p.book.tags.map((t) => t.tag.name),
        confirmedByUser: p.confirmedByUser,
        isNearFull: p.isNearFull,
      }));
      return {
        id: level.id,
        levelIndex: level.levelIndex,
        widthMm: level.widthMm,
        heightMm: level.heightMm,
        depthMm: level.depthMm,
        note: level.note,
        zones: level.tagZones.map((z) => ({ id: z.tag.id, name: z.tag.name, color: z.tag.color })),
        usage: levelUsage(level, books, coeffs),
        // 只返回**画得到、点得开**的字段。
        // 这个接口是无界的（书架图要画出每一根书脊），所以每本多带一个字段，
        // 代价就要乘以全库的书数，而且 /map、/space、/shelves、扫码页四处都要拉一遍。
        // tagNames 早在标签降级后就没人看了；ddc / spineSource / confirmedByUser
        // 也只有书籍详情页用，而详情页有自己的查询。
        books: books.map((b) => {
          const spine = estimateSpine(b, coeffs);
          return {
            id: b.id,
            title: b.title,
            authors: b.authors,     // 层详情弹窗里显示
            coverUrl: b.coverUrl,   // 同上
            isNearFull: b.isNearFull,
            // 地图上每本书的条宽按这个等比画，所以必须逐本返回而不是取平均
            spineMm: spine.mm,
            // 立面图按真实书高画书脊，没有就退回层高的比例
            heightMm: b.heightMm,
            clc: b.clc,
            callNumber: b.callNumber,
          };
        }),
      };
    }),
  }));

  return ok({ bookcases: shaped, coefficients: coeffs });
});
