// 整屋布局规划 —— 预览「如果重新安排，全屋会是什么样」
//
// 和 /api/shelving/reflow 的分工：
//   reflow  = 局部急救，某一层溢出了该挪谁（日常）
//   layout  = 全局体检，整屋重排一遍会怎么样（偶尔，且永远只是预览）
// 这里**只出方案，不落库**。搬动要经 reflow 的 POST，那条路带撤销。
import { z } from "zod";
import { getCoefficients } from "@/lib/settings";
import { loadLayoutWorld } from "@/lib/layoutLoad";
import { planLayoutAsync, DEFAULT_WEIGHTS } from "@/lib/layout";
import { clcLabel } from "@/lib/clc";
import { resolveLocale } from "@/i18n/request";
import { ok, route } from "@/lib/api";

const querySchema = z.object({
  /** 惯性：越大越保守。0 = 从零开始的理想布局 */
  move: z.coerce.number().min(0).max(1e6).optional(),
  fillTarget: z.coerce.number().min(0.2).max(0.98).optional(),
});

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const q = querySchema.parse(Object.fromEntries(url.searchParams));

  const [{ bookcases, books }, coeffs, locale] = await Promise.all([
    loadLayoutWorld(),
    getCoefficients(),
    resolveLocale(),
  ]);

  const weights = {
    move: q.move ?? DEFAULT_WEIGHTS.move,
    fillTarget: q.fillTarget ?? DEFAULT_WEIGHTS.fillTarget,
  };
  // 切片版：这段是纯 CPU，同步跑会把整个服务堵住（5000 本要 1.6 秒，
  // 期间全家谁扫码都得排队）。planLayoutAsync 每 40ms 让出一次事件循环。
  const plan = await planLayoutAsync(bookcases, books, { weights, coeffs });

  const levelMeta = new Map(
    bookcases.flatMap((bc) =>
      bc.levels.map((l) => [l.id, { bookcaseName: bc.name, roomName: bc.roomName, levelIndex: l.levelIndex }] as const),
    ),
  );
  const titleOf = new Map(books.map((b) => [b.id, b.title]));

  return ok({
    weights,
    totals: {
      books: books.length,
      placed: plan.assignments.length,
      moves: plan.moves,
      unplaced: plan.unplaced.length,
      exceptions: plan.exceptions.length,
      cost: plan.cost,
    },
    // 每个柜子现在该管哪一段 —— 用户理解整套布局的入口
    bays: plan.bays.map((b) => ({
      ...b,
      count: b.to - b.from,
      label: b.label,
      labelText: clcLabel(b.label, locale),
    })),
    levels: plan.levels.map((l) => ({
      ...l,
      ...(levelMeta.get(l.levelId) ?? {}),
      dominantLabel: clcLabel(l.dominantClass, locale),
      count: l.bookIds.length,
    })),
    // 只把真要动的列出来，没动的没必要占篇幅
    moves: plan.assignments
      .filter((a) => a.moved)
      .map((a) => ({
        bookId: a.bookId,
        title: titleOf.get(a.bookId) ?? "",
        fromLevelId: a.fromLevelId,
        toLevelId: a.levelId,
        from: a.fromLevelId ? levelMeta.get(a.fromLevelId) ?? null : null,
        to: levelMeta.get(a.levelId) ?? null,
      })),
    unplaced: plan.unplaced,
    // 「这一层是几个小类拼起来的」—— 用户明确要求过要被告知，不能等他走到架子前才发现
    merges: plan.merges.map((m) => ({ ...m, ...(levelMeta.get(m.levelId) ?? {}) })),
    exceptions: plan.exceptions.map((e) => ({ ...e, ...(levelMeta.get(e.levelId) ?? {}) })),
  });
});
