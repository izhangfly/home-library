import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, readJson, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  nameEn: z.string().trim().optional().nullable(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortKey: z.number().int().optional(),
  /** 该标签占用的层（分区），整组替换 */
  levelIds: z.array(z.string()).optional(),
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { levelIds, ...rest } = patchSchema.parse(await readJson(req));

  if (Object.keys(rest).length) {
    await prisma.tag.update({ where: { id }, data: rest });
  }

  if (levelIds) {
    await prisma.tagZone.deleteMany({ where: { tagId: id } });
    if (levelIds.length) {
      await prisma.tagZone.createMany({
        data: levelIds.map((levelId) => ({ tagId: id, levelId })),
        skipDuplicates: true,
      });
    }
  }

  const tag = await prisma.tag.findUnique({
    where: { id },
    include: {
      _count: { select: { books: true } },
      zones: { include: { level: { include: { bookcase: { select: { name: true } } } } } },
    },
  });
  return ok({ tag });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await prisma.tag.delete({ where: { id } });
  return ok({ deleted: true });
});
