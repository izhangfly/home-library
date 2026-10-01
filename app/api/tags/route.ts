import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, readJson, route } from "@/lib/api";

export const GET = route(async () => {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortKey: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { books: true } },
      zones: { include: { level: { include: { bookcase: { select: { name: true } } } } } },
    },
  });
  return ok({ tags });
});

const tagSchema = z.object({
  name: z.string().trim().min(1),
  nameEn: z.string().trim().optional().nullable(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortKey: z.number().int().optional(),
});

export const POST = route(async (req: Request) => {
  const input = tagSchema.parse(await readJson(req));
  const tag = await prisma.tag.create({
    data: { ...input, nameEn: input.nameEn || null },
  });
  return ok({ tag }, { status: 201 });
});
