// 中图法类表 + 各大类藏书量，给筛选下拉和 3D 标签用
import { CLC_CLASSES, CLC_CLASS_COLOR, CLC_DIVISIONS } from "@/lib/clc";
import { prisma } from "@/lib/prisma";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  const rows = await prisma.book.groupBy({
    by: ["clc"],
    _count: { _all: true },
    where: { clc: { not: null } },
  });

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const main = (r.clc ?? "")[0];
    if (main) counts[main] = (counts[main] ?? 0) + r._count._all;
  }

  return ok({
    classes: CLC_CLASSES.map((c) => ({
      ...c,
      color: CLC_CLASS_COLOR[c.code],
      count: counts[c.code] ?? 0,
    })),
    divisions: CLC_DIVISIONS,
  });
});
