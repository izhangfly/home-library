import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { ok, readJson, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortKey: z.number().int().optional(),
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  await requireAdmin();
  const { id } = await params;
  const input = patchSchema.parse(await readJson(req));
  const room = await prisma.room.update({ where: { id }, data: input });

  // 房间改名后，落在里面的书柜的 room 文本要跟着走，否则检索路径显示的是旧名字
  if (input.name) {
    await prisma.bookcase.updateMany({ where: { roomId: id }, data: { room: input.name } });
  }
  return ok({ room });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  await requireAdmin();
  const { id } = await params;
  await prisma.room.delete({ where: { id } });
  return ok({ deleted: true });
});
