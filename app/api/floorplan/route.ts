// 户型图：上传 DXF（管理员）/ 读取
import { prisma } from "@/lib/prisma";
import { matchRooms } from "@/lib/roomMatch";
import { parseDxf } from "@/lib/dxf";
import { requireAdmin } from "@/lib/auth";
import { pointInPolygon, type Pt } from "@/lib/geometry";
import { detectRoomsFromWalls } from "@/lib/planar";
import { fail, ok, readForm, route } from "@/lib/api";

const MAX_BYTES = 20 * 1024 * 1024;

export const GET = route(async () => {
  const plans = await prisma.floorPlan.findMany({
    orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }],
    include: {
      bookcases: {
        select: {
          id: true, name: true, room: true, roomX: true, roomY: true,
          rotation: true, widthMm: true, depthMm: true, heightMm: true, color: true,
        },
      },
    },
  });

  // 只有一张图时，把还没挂图的书柜一并补上并摆到图纸中心。
  // 否则新建的书柜会"不在任何图上"，用户在户型图里根本找不到它。
  if (plans.length === 1) {
    const plan = plans[0];
    const orphans = await prisma.bookcase.findMany({
      where: { floorPlanId: null },
      select: { id: true },
    });
    if (orphans.length) {
      const cx = Math.round((plan.minX + plan.maxX) / 2);
      const cy = Math.round((plan.minY + plan.maxY) / 2);
      const spanX = (plan.maxX - plan.minX) * 0.5;
      await Promise.all(
        orphans.map((bc, i) =>
          prisma.bookcase.update({
            where: { id: bc.id },
            data: {
              floorPlanId: plan.id,
              // 横向错开，免得几个柜子完全重叠在中心点上没法分别拖动
              roomX: Math.round(cx + (i - (orphans.length - 1) / 2) * (spanX / Math.max(1, orphans.length))),
              roomY: cy,
            },
          }),
        ),
      );
      return ok({ plans: await prisma.floorPlan.findMany({
        orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }],
        include: { bookcases: {
          select: { id: true, name: true, room: true, roomX: true, roomY: true,
                    rotation: true, widthMm: true, depthMm: true, heightMm: true, color: true },
        } },
      }) });
    }
  }

  return ok({ plans });
});

export const POST = route(async (req: Request) => {
  await requireAdmin();

  const form = await readForm(req);
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  const replaceId = String(form.get("replaceId") ?? "").trim();

  if (!(file instanceof File)) return fail("missing_file", 400);
  if (file.size > MAX_BYTES) return fail("file_too_large", 413);

  // DXF 是纯文本；AutoCAD 中文版常用 GBK，所以先试 UTF-8 再退回 GBK
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = buffer.toString("utf8");
  if (text.includes("�")) {
    try {
      text = new TextDecoder("gbk").decode(buffer);
    } catch {
      // 环境不支持 gbk 就还用 utf8，几何数据是 ASCII 数字，不受影响
    }
  }

  const plan = parseDxf(text);
  if (!plan.shapes.length) return fail("no_geometry", 422);

  const data = {
    name: name || file.name.replace(/\.dxf$/i, "") || "户型图",
    fileName: file.name,
    geometry: plan.shapes as unknown as object,
    minX: plan.minX,
    minY: plan.minY,
    maxX: plan.maxX,
    maxY: plan.maxY,
    sourceUnits: plan.sourceUnits,
    unitScale: plan.unitScale,
  };

  const saved = replaceId
    ? await prisma.floorPlan.update({ where: { id: replaceId }, data })
    : await prisma.floorPlan.create({ data });

  // 还没归属到任何户型图的书柜，自动挂到这张图上。
  // 家里就一张户型图，让用户再手动关联一次纯属折腾。
  const orphans = await prisma.bookcase.findMany({
    where: { floorPlanId: null },
    select: { id: true, roomX: true, roomY: true },
  });
  if (orphans.length) {
    const spanX = plan.maxX - plan.minX;
    const spanY = plan.maxY - plan.minY;
    await Promise.all(
      orphans.map((bc, i) => {
        // 之前的 roomX/roomY 是 0/1/2 这种占位值（单位是毫米就等于全挤在原点），
        // 挤在一起没法拖。这里沿对角线摊开，用户拖一下就到位。
        const placeholder = Math.abs(bc.roomX) < 100 && Math.abs(bc.roomY) < 100;
        const frac = (i + 1) / (orphans.length + 1);
        return prisma.bookcase.update({
          where: { id: bc.id },
          data: {
            floorPlanId: saved.id,
            ...(placeholder
              ? {
                  roomX: Math.round(plan.minX + spanX * frac),
                  roomY: Math.round(plan.minY + spanY * frac),
                }
              : {}),
          },
        });
      }),
    );
  }

  // 顺手识别房间：闭合多段线里挑出面积合理、且不包着别人的那些
  const detected = detectRoomsFromWalls(
    plan.shapes
      .filter((s) => s.kind === "polyline")
      .map((s) => ({ points: (s as { points: Pt[] }).points, closed: (s as { closed: boolean }).closed })),
  );
  const PALETTE = ["#E0E0FF", "#FFF3C4", "#C9F2D6", "#FBD5D5", "#FDE6BF", "#D9F0F7", "#F3E0FF"];
  if (detected.length) {
    // 不能 deleteMany + createMany —— 那样每个房间都会变回「房间 N」，
    // 用户一个个手打的名字全没；房间 id 也全换，书柜（onDelete: SetNull）
    // 跟着断开，手动「转移」过的那些会被几何位置覆盖回去。
    // 所以：能对上的**原地更新**（id 不变），新出现的才创建，消失的才删除。
    const before = await prisma.room.findMany({
      where: { floorPlanId: saved.id },
      select: { id: true, name: true, polygon: true },
    });
    const matches = matchRooms(
      detected.map((d) => ({ polygon: d.polygon as Pt[], areaMm2: d.areaMm2 })),
      before.map((r) => ({ id: r.id, name: r.name, polygon: r.polygon as Pt[] })),
    );

    // 整段一个事务：中途失败的话，宁可一个房间都没动，
    // 也不要留下"删了一半、名字丢了一半"的户型图。
    await prisma.$transaction(async (tx) => {
      const keptIds = new Set(matches.map((m) => m.existingId).filter(Boolean) as string[]);
      const gone = before.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
      if (gone.length) await tx.room.deleteMany({ where: { id: { in: gone } } });

      for (let i = 0; i < detected.length; i++) {
        const d = detected[i];
        const m = matches[i];
        const shape = {
          polygon: d.polygon,
          areaMm2: d.areaMm2,
          sortKey: i,
          color: PALETTE[i % PALETTE.length],
        };
        if (m.existingId) {
          // 名字只在旧的是占位名时才覆盖 —— 用户打过的名字不动
          await tx.room.update({
            where: { id: m.existingId },
            data: m.keepName ? shape : { ...shape, name: `房间 ${i + 1}` },
          });
        } else {
          await tx.room.create({
            data: { ...shape, floorPlanId: saved.id, name: `房间 ${i + 1}` },
          });
        }
      }
    });

    // 书柜按坐标落进房间 —— **只补没有房间的那些**。
    // 已经有房间的不动：那可能是用户手动转移过去的，几何位置说了不算。
    const [rooms, bcs] = await Promise.all([
      prisma.room.findMany({ where: { floorPlanId: saved.id } }),
      prisma.bookcase.findMany({ where: { floorPlanId: saved.id } }),
    ]);
    const liveRoomIds = new Set(rooms.map((r) => r.id));
    for (const bc of bcs) {
      if (bc.roomId && liveRoomIds.has(bc.roomId)) continue;
      const hit = rooms.find((r) => pointInPolygon([bc.roomX, bc.roomY], r.polygon as Pt[]));
      if (hit) await prisma.bookcase.update({ where: { id: bc.id }, data: { roomId: hit.id, room: hit.name } });
    }
  }

  return ok({
    plan: saved,
    rooms: detected.length,
    stats: {
      shapes: plan.shapes.length,
      layers: plan.layers,
      widthMm: Math.round(plan.maxX - plan.minX),
      depthMm: Math.round(plan.maxY - plan.minY),
      sourceUnits: plan.sourceUnits,
    },
  });
});

export const DELETE = route(async (req: Request) => {
  await requireAdmin();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("missing_id", 400);
  await prisma.floorPlan.delete({ where: { id } });
  return ok({ deleted: true });
});
