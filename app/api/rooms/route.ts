// 房间：从户型图自动识别 / 重命名 / 着色 / 重新归属书柜
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { centroid, pointInPolygon, type Pt } from "@/lib/geometry";
import { detectRoomsFromWalls } from "@/lib/planar";
import { roomColor } from "@/lib/roomColors";
import { fail, ok, readJson, route } from "@/lib/api";

export const GET = route(async () => {
  const rooms = await prisma.room.findMany({
    orderBy: [{ sortKey: "asc" }, { name: "asc" }],
    include: { bookcases: { select: { id: true, name: true } } },
  });
  return ok({ rooms });
});

/** 把书柜按坐标落到房间里 —— 拖动书柜或重识别房间之后都要跑一次 */
export async function reassignBookcasesToRooms(floorPlanId: string) {
  const [rooms, bookcases] = await Promise.all([
    prisma.room.findMany({ where: { floorPlanId } }),
    prisma.bookcase.findMany({ where: { floorPlanId } }),
  ]);

  await Promise.all(
    bookcases.map((bc) => {
      const hit = rooms.find((r) => pointInPolygon([bc.roomX, bc.roomY], r.polygon as Pt[]));
      // 找不到就置空：书柜可能被拖到了走廊或房间外，硬塞进某个房间只会误导
      if (bc.roomId === (hit?.id ?? null)) return null;
      return prisma.bookcase.update({
        where: { id: bc.id },
        data: { roomId: hit?.id ?? null, room: hit?.name ?? bc.room },
      });
    }).filter(Boolean) as Promise<unknown>[],
  );
}

const detectSchema = z.object({ floorPlanId: z.string().min(1) });

/** 自动识别房间。已命名的房间不会被覆盖（按质心就近匹配保留名字）。 */
export const POST = route(async (req: Request) => {
  await requireAdmin();
  const { floorPlanId } = detectSchema.parse(await readJson(req));

  const plan = await prisma.floorPlan.findUnique({ where: { id: floorPlanId } });
  if (!plan) return fail("plan_not_found", 404);

  const shapes = plan.geometry as { kind: string; points?: Pt[]; closed?: boolean }[];
  const polys = shapes
    .filter((s) => s.kind === "polyline" && s.points)
    .map((s) => ({ points: s.points as Pt[], closed: !!s.closed }));

  const detected = detectRoomsFromWalls(polys);
  if (!detected.length) return fail("no_rooms_detected", 422);

  const existing = await prisma.room.findMany({ where: { floorPlanId } });

  // 已有房间按质心距离配对，保住用户起的名字
  const used = new Set<string>();
  const rows = detected.map((d, i) => {
    const c = centroid(d.polygon);
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const e of existing) {
      if (used.has(e.id)) continue;
      const ec = centroid(e.polygon as Pt[]);
      const dist = Math.hypot(ec[0] - c[0], ec[1] - c[1]);
      // 质心相距 1.5m 以内认为是同一个房间
      if (dist < 1500 && dist < bestDist) {
        bestDist = dist;
        bestId = e.id;
      }
    }
    if (bestId) used.add(bestId);
    return { detected: d, matchId: bestId, index: i };
  });

  await prisma.$transaction([
    // 没配上的旧房间删掉（户型图换了，它们不再存在）
    prisma.room.deleteMany({
      where: { floorPlanId, id: { notIn: Array.from(used) as string[] } },
    }),
    // 颜色一律按序号重算：用户不挑颜色，那就保证任何时候相邻房间都不撞色
    ...rows.map((r) =>
      r.matchId
        ? prisma.room.update({
            where: { id: r.matchId },
            data: {
              polygon: r.detected.polygon,
              areaMm2: r.detected.areaMm2,
              color: roomColor(r.index),
              sortKey: r.index,
            },
          })
        : prisma.room.create({
            data: {
              floorPlanId,
              name: `房间 ${r.index + 1}`,
              color: roomColor(r.index),
              polygon: r.detected.polygon,
              areaMm2: r.detected.areaMm2,
              sortKey: r.index,
            },
          }),
    ),
  ]);

  await reassignBookcasesToRooms(floorPlanId);

  const rooms = await prisma.room.findMany({
    where: { floorPlanId },
    orderBy: [{ sortKey: "asc" }],
    include: { bookcases: { select: { id: true, name: true } } },
  });
  return ok({ rooms, detected: detected.length });
});
