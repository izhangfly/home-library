import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { clampIntoPolygon, labelPoint, pointInPolygon, type Pt } from "@/lib/geometry";
import { fail, ok, readJson, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  room: z.string().trim().optional().nullable(),
  /** 显式转移到某个房间。null = 解除绑定（书柜就可以随便拖了） */
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

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  await requireAdmin();
  const { id } = await params;
  const { roomId, ...rest } = patchSchema.parse(await readJson(req));

  const before = await prisma.bookcase.findUnique({ where: { id } });
  if (!before) return ok({ bookcase: null }, { status: 404 });

  // ---- 房间绑定 ----
  // 书柜属于一个房间，拖动只能在这个房间里动；要换房间得走"转移"，
  // 这样才不会一手滑就把整柜书划到别的屋去，而检索路径还显示着旧房间。
  const targetRoomId = roomId !== undefined ? roomId : before.roomId;
  const targetRoom = targetRoomId
    ? await prisma.room.findUnique({ where: { id: targetRoomId } })
    : null;

  const data: Record<string, unknown> = { ...rest };

  if (roomId !== undefined) {
    data.roomId = targetRoom?.id ?? null;
    data.room = targetRoom?.name ?? null;
    if (targetRoom) {
      // 转移过来时，如果当前位置不在新房间里，就放到房间正中最宽敞的地方
      const poly = targetRoom.polygon as Pt[];
      const here: Pt = [
        rest.roomX ?? before.roomX,
        rest.roomY ?? before.roomY,
      ];
      const [x, y] = pointInPolygon(here, poly) ? here : labelPoint(poly);
      data.roomX = Math.round(x);
      data.roomY = Math.round(y);
      if (targetRoom.floorPlanId) data.floorPlanId = targetRoom.floorPlanId;
    }
  } else if (targetRoom && (rest.roomX !== undefined || rest.roomY !== undefined)) {
    // 普通拖动：越界就贴着墙停下
    const [x, y] = clampIntoPolygon(
      [rest.roomX ?? before.roomX, rest.roomY ?? before.roomY],
      targetRoom.polygon as Pt[],
    );
    data.roomX = x;
    data.roomY = y;
  }

  const bookcase = await prisma.bookcase.update({
    where: { id },
    data,
    include: { levels: { orderBy: { levelIndex: "asc" } } },
  });

  // 还没绑定房间的书柜，按坐标自动落进房间 —— 老数据和刚建的柜子走这条路
  if (!targetRoom && roomId === undefined && bookcase.floorPlanId &&
      (rest.roomX !== undefined || rest.roomY !== undefined)) {
    const rooms = await prisma.room.findMany({ where: { floorPlanId: bookcase.floorPlanId } });
    const hit = rooms.find((r) => pointInPolygon([bookcase.roomX, bookcase.roomY], r.polygon as Pt[]));
    if ((hit?.id ?? null) !== bookcase.roomId) {
      await prisma.bookcase.update({
        where: { id },
        data: { roomId: hit?.id ?? null, room: hit?.name ?? null },
      });
    }
  }

  return ok({ bookcase });
});


/**
 * 有书就先拦一道 —— 和"放一本书到临界层"用的是同一套规矩。
 *
 * 这个应用为了**一本**书放进快满的层，会返回 409 让用户确认（spec 硬性要求）。
 * 而删一个书柜会级联删掉它所有层、所有上架关系 —— 一次可能是几百本 ——
 * 服务端却一道拦截都没有，界面上那句提示还是**不带数字**的：
 * 「层上的书会变成未上架」。柜子里是 0 本还是 200 本，这句话长得一模一样，
 * 而这两种情况一个是随手操作、一个是灾难。人只会一路点确定。
 *
 * 而且客户端的 confirm 挡不住任何东西：CLAUDE.md 里已经记着一次教训 ——
 * 只放在客户端的判断，换个调用方就没了。
 *
 * 拦截而不是禁止：柜子拆了重建是正常需求，只是要**知道自己在删什么**。
 */
export const DELETE = route(async (req: Request, { params }: Ctx) => {
  await requireAdmin();
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";

  // Level 和 Placement 都是级联删除，书本身保留，只是变回"未上架"
  const books = await prisma.placement.count({ where: { level: { bookcaseId: id } } });
  if (books > 0 && !force) return fail("has_books", 409, { books });

  await prisma.bookcase.delete({ where: { id } });
  return ok({ deleted: true, unshelved: books });
});
