import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, readJson, route } from "@/lib/api";

const levelSchema = z.object({
  bookcaseId: z.string().min(1),
  levelIndex: z.number().int().positive(),
  widthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  depthMm: z.number().int().positive(),
  note: z.string().trim().optional().nullable(),
});

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const input = levelSchema.parse(await readJson(req));

  const clash = await prisma.level.findUnique({
    where: { bookcaseId_levelIndex: { bookcaseId: input.bookcaseId, levelIndex: input.levelIndex } },
  });
  if (clash) return fail("level_index_taken", 409);

  const level = await prisma.level.create({
    data: { ...input, note: input.note || null },
  });
  return ok({ level }, { status: 201 });
});
