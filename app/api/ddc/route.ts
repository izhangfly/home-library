// DDC 类表：给前端做筛选下拉和标签展示用。
import { DDC_CLASSES, DDC_CLASS_COLOR, DDC_DIVISIONS } from "@/lib/ddc";
import { prisma } from "@/lib/prisma";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  // 顺带统计每个大类下有多少本书，空类就不用出现在筛选里
  const rows = await prisma.book.groupBy({
    by: ["ddc"],
    _count: { _all: true },
    where: { ddc: { not: null } },
  });

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const main = (r.ddc ?? "")[0] + "00";
    counts[main] = (counts[main] ?? 0) + r._count._all;
  }

  return ok({
    classes: DDC_CLASSES.map((c) => ({ ...c, color: DDC_CLASS_COLOR[c.code], count: counts[c.code] ?? 0 })),
    divisions: DDC_DIVISIONS,
  });
});
