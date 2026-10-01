import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { labelPoint, type Pt } from "@/lib/geometry";
import { ok, readJson, route } from "@/lib/api";

export const GET = route(async () => {
  const bookcases = await prisma.bookcase.findMany({
    orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }],
    include: {
      levels: {
        orderBy: { levelIndex: "asc" },
        include: { _count: { select: { placements: true } } },
      },
    },
  });
  return ok({ bookcases });
});

const bookcaseSchema = z.object({
  name: z.string().trim().min(1),
  room: z.string().trim().optional().nullable(),
  /** 新建时就选好房间 —— 书柜必须住在某个房间里 */
  roomId: z.string().trim().nullable().optional(),
  roomX: z.number().optional(),
  roomY: z.number().optional(),
  rotation: z.number().optional(),
  widthMm: z.number().int().positive().optional().nullable(),
  depthMm: z.number().int().positive().optional().nullable(),
  heightMm: z.number().int().positive().optional().nullable(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortKey: z.number().int().optional(),
  note: z.string().trim().optional().nullable(),
});

// 书架结构的增删改需要管理员密码 —— F5
export const POST = route(async (req: Request) => {
  await requireAdmin();
  const { roomId, ...input } = bookcaseSchema.parse(await readJson(req));

  // 只有一张户型图时自动挂上去，并默认摆在图纸中心 —— 建完柜子直接就能在图上拖，
  // 不用再回去做一次"关联户型图"的操作。
  const plans = await prisma.floorPlan.findMany({ take: 2, orderBy: { sortKey: "asc" } });
  const onlyPlan = plans.length === 1 ? plans[0] : null;
  const room = roomId ? await prisma.room.findUnique({ where: { id: roomId } }) : null;

  // 选了房间就落在房间最宽敞处，没选才退回图纸中心
  const placed = room
    ? (() => {
        const [x, y] = labelPoint(room.polygon as Pt[]);
        return { roomX: Math.round(x), roomY: Math.round(y) };
      })()
    : onlyPlan && !input.roomX && !input.roomY
      ? {
          roomX: Math.round((onlyPlan.minX + onlyPlan.maxX) / 2),
          roomY: Math.round((onlyPlan.minY + onlyPlan.maxY) / 2),
        }
      : {};

  const bookcase = await prisma.bookcase.create({
    data: {
      ...input,
      room: room?.name ?? input.room ?? null,
      roomId: room?.id ?? null,
      note: input.note || null,
      floorPlanId: room?.floorPlanId ?? onlyPlan?.id ?? null,
      ...placed,
    },
    include: { levels: true },
  });
  return ok({ bookcase }, { status: 201 });
});
