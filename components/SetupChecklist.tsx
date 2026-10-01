// 「还差什么」—— 把系统自己知道、但从来没说的事说出来
//
// 这个应用手上握着一堆用户需要知道的事实，却只在首页显示一排计数：
//   * 两个书柜的柜体尺寸都是空的 → 户型图和 3D 只能按默认值 800×300 画，
//     图上那个方块和你家那个柜子根本不是一回事
//   * 十六个房间里十三个还叫「房间 7」→ 检索路径显示「房间 7 › 书柜 › 第 2 层」，
//     等于没告诉你在哪儿
//   * 书脊系数还没校准 → 每一层的装填率都是照 80g 纸估出来的
// 这些都不是错误，不该报警；但也不该让人自己去发现。
//
// 规矩：只显示**没做完**的，每条都说清楚**为什么要紧**，都能点过去，
// 全做完了整块消失 —— 不留一个"全都打勾了"的面板占地方。

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { calibrate, type CalibrationSample } from "@/lib/calibrate";
import { levelUsage } from "@/lib/capacity";
import { getCoefficients } from "@/lib/settings";
import { loadShelfState } from "@/lib/shelfState";
import { IconWarn } from "./icons";

interface Item {
  key: string;
  count: number;
  href: string;
  /** 区间的上界（只有"估的"那条用得上） */
  extra?: number;
}

export async function SetupChecklist() {
  const t = await getTranslations();

  const [bookcases, rooms, unshelved, plans, calRow, levelsWithBooks] = await Promise.all([
    prisma.bookcase.findMany({ select: { widthMm: true, depthMm: true, heightMm: true, _count: { select: { levels: true } } } }),
    prisma.room.findMany({ select: { name: true } }),
    prisma.book.count({ where: { placement: { is: null } } }),
    prisma.floorPlan.count(),
    prisma.setting.findUnique({ where: { key: "calibration.samples" } }),
    prisma.level.count({ where: { placements: { some: {} } } }),
  ]);

  const items: Item[] = [];

  // 柜体尺寸空着**而且一层都没建** → 这时才真的没数可用，画出来是瞎猜的 800×300。
  // 只要建了层，尺寸就能从层推出来（lib/shelfGeometry），不该再拿这件事烦用户。
  const noSize = bookcases.filter(
    (b) => (!b.widthMm || !b.depthMm || !b.heightMm) && b._count.levels === 0,
  ).length;
  if (noSize) items.push({ key: "bookcaseSize", count: noSize, href: "/shelves" });

  // 还叫「房间 N」→ 检索路径里等于没有信息
  const unnamed = rooms.filter((r) => /^房间\s*\d+$/.test(r.name)).length;
  if (unnamed) items.push({ key: "roomNames", count: unnamed, href: "/shelves" });

  // 书架快满了 —— 这是**预报**，不是故障。
  //
  // 阈值 90% 是量出来的，不是拍的。scripts/measure-churn.mts 逐本加书测
  // "加一本要搬动几本"：
  //     ≤96%   中位 0，最差 4      —— 加书基本不动别的
  //      97%   中位 1，p90 8
  //      98%   中位 7，p90 11
  //      99%   中位 4，**最差 131**  —— 加一本书让你搬 131 本
  // 拐点在 97%。真到那儿再说就晚了：买柜子、腾地方都要时间，
  // 所以提前到 90% 就开口，留出余量。
  //
  // 说"还能放多少本"而不是"用了百分之多少"：百分比要用户自己换算成行动，
  // "还能放约 60 本"他立刻知道这意味着什么。
  const [state, coeffs] = await Promise.all([loadShelfState(), getCoefficients()]);
  const usages = state.levels.map((l) => levelUsage(l, state.occupancy.get(l.id) ?? [], coeffs));
  const usable = usages.reduce((s2, u) => s2 + u.usableMm, 0);
  const used = usages.reduce((s2, u) => s2 + u.usedMm, 0);
  const placedBooks = usages.reduce((s2, u) => s2 + u.bookCount, 0);
  if (usable > 0 && placedBooks >= 20) {
    const ratio = used / usable;
    if (ratio >= 0.9) {
      // 按目前的平均脊厚估还能放几本 —— 到 96%（拐点前）为止
      const avgSpine = used / placedBooks;
      const room = Math.max(0, Math.floor((usable * 0.96 - used) / avgSpine));

      // 这个数字有多可信，取决于有多少本书的宽度是**量过的**。
      //
      // 没量过的按页数 × mmPerPage 推，而默认的 0.052 只是"80g 纸"的经验值。
      // 真实纸张从 60g 到 100g 都有，实测这 6 本：mmPerPage 取 0.046 时
      // 一米的层放得下 48 本，取 0.070 时只放得下 33 本 —— 差了近一半。
      // 也就是说没校准时说"还能放 60 本"是**假精确**：真话是 40 到 80 之间。
      //
      // 所以估的多就换一句话：给范围、并且指到校准去。
      // 宁可说得糊一点，也不要给一个听起来很准、实际可能差一倍的数。
      const estimated = usages.reduce((s2, u) => s2 + u.estimatedCount, 0);
      const mostlyGuessed = estimated > placedBooks * 0.5;
      items.push({
        key: mostlyGuessed ? "shelfFullRough" : "shelfFull",
        count: mostlyGuessed ? Math.max(1, Math.round(room * 0.7)) : room,
        href: mostlyGuessed ? "/settings" : "/reflow",
        ...(mostlyGuessed ? { extra: Math.round(room * 1.4) } : {}),
      });
    }
  }

  if (!plans) items.push({ key: "floorPlan", count: 1, href: "/shelves" });
  if (unshelved) items.push({ key: "unshelved", count: unshelved, href: "/books?shelved=no" });

  // 书脊系数校准 —— 有两层书之后才提得起，否则是噪音
  const samples = (calRow?.value as CalibrationSample[] | undefined) ?? [];
  if (levelsWithBooks >= 2 && calibrate(samples).status !== "ok") {
    items.push({ key: "calibrate", count: levelsWithBooks, href: "/settings" });
  }

  if (!items.length) return null;

  return (
    <section className="card mb-4 p-4">
      <h2 className="section-title mb-1 flex items-center gap-2">
        <IconWarn className="h-4 w-4 text-warning" />
        {t("setup.title")}
      </h2>
      <p className="hint mb-3">{t("setup.hint")}</p>
      <ul className="flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border-2 border-border bg-surface-2 p-2 hover:bg-surface-3"
            >
              <span className="font-black">
                {t(`setup.${it.key}.what`, { count: it.count, upper: it.extra ?? it.count })}
              </span>
              <span className="hint flex-1">{t(`setup.${it.key}.why`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
