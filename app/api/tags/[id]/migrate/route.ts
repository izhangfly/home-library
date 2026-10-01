// 批量迁移：把某个标签下的所有书一次性挪到目标层 —— F3 验收条件 4
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { refreshBookDerived } from "@/lib/books";
import { fail, ok, readJson, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  levelId: z.string().min(1),
  /** 迁移后把该层设为这个标签的分区 */
  updateZone: z.boolean().optional(),
});

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id: tagId } = await params;
  const { levelId, updateZone = true } = schema.parse(await readJson(req));

  const [tag, level] = await Promise.all([
    prisma.tag.findUnique({ where: { id: tagId }, include: { books: true } }),
    prisma.level.findUnique({ where: { id: levelId } }),
  ]);
  if (!tag) return fail("tag_not_found", 404);
  if (!level) return fail("level_not_found", 404);

  const bookIds = tag.books.map((bt) => bt.bookId);
  if (!bookIds.length) return ok({ moved: 0 });

  // 迁移是用户在看过建议后主动确认的动作，这里不再做容量拦截，
  // 否则「腾挪到底放不放得下」这种事会变成死循环。
  await prisma.$transaction([
    prisma.placement.deleteMany({ where: { bookId: { in: bookIds } } }),
    prisma.placement.createMany({
      data: bookIds.map((bookId, i) => ({
        bookId,
        levelId,
        orderInLevel: i,
        confirmedByUser: true,
      })),
    }),
    ...(updateZone
      ? [
          prisma.tagZone.deleteMany({ where: { tagId } }),
          prisma.tagZone.create({ data: { tagId, levelId } }),
        ]
      : []),
  ]);

  await Promise.all(bookIds.map((bookId) => refreshBookDerived(bookId)));
  return ok({ moved: bookIds.length });
});
