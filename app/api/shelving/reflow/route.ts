// 重排：体检 → 预览搬动清单 → 用户确认后执行（可撤销）
//
// 绝不自动执行。用户明确要求"很少地、只在真的必要时才动"，
// 而且搬书是物理动作 —— 系统单方面改数据库，人和书架就对不上了。
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCoefficients } from "@/lib/settings";
import { loadShelfWorld } from "@/lib/shelfLoad";
import { auditShelves, buildLevelStates, planReflow } from "@/lib/shelving";
import { clcLabel } from "@/lib/clc";
import { resolveLocale } from "@/i18n/request";
import { fail, ok, readJson, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { BatchNotFound, applyMoves, undoBatch } from "@/lib/reflowService";

/** 体检 + 预览：哪些层满了，建议怎么挪 */
export const GET = route(async () => {
  const [{ levels, books }, coeffs, locale] = await Promise.all([
    loadShelfWorld(),
    getCoefficients(),
    resolveLocale(),
  ]);

  const states = buildLevelStates(levels, books, coeffs);
  const audit = auditShelves(states);

  const plans = audit.overflow.map((levelId) => {
    const plan = planReflow(levelId, states, { coeffs });
    const st = states.get(levelId)!;
    return {
      levelId,
      bookcaseName: st.level.bookcaseName,
      roomName: st.level.roomName,
      levelIndex: st.level.levelIndex,
      overflowMm: Math.round(-st.freeMm),
      ...plan,
      affectedLabel: clcLabel(plan.affectedClass, locale),
    };
  });

  const detail = (ids: string[]) =>
    ids.map((id) => {
      const st = states.get(id)!;
      return {
        levelId: id,
        bookcaseName: st.level.bookcaseName,
        roomName: st.level.roomName,
        levelIndex: st.level.levelIndex,
        usedMm: st.usedMm,
        usableMm: st.usableMm,
        fill: st.usableMm ? Math.round((st.usedMm / st.usableMm) * 100) : 0,
        dominantLabel: clcLabel(st.dominantClass, locale),
      };
    });

  // 可撤销的批次要从库里读，不能只存在组件的 state 里。
  // 以前刷新一下页面撤销按钮就没了 —— 而「整屋规划」那边根本没接住 batchId，
  // 界面上却写着"执行后可在整理建议页一键撤销"，那句话是假的。
  const batchRows = await prisma.setting.findMany({
    where: { key: { startsWith: "moveBatch." } },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  const batches = batchRows.map((r) => {
    const v = r.value as { at?: string; note?: string | null; entries?: unknown[] };
    return {
      batchId: r.key.replace("moveBatch.", ""),
      at: v.at ?? r.updatedAt.toISOString(),
      note: v.note ?? null,
      count: Array.isArray(v.entries) ? v.entries.length : 0,
    };
  }).filter((b) => b.count > 0);

  return ok({
    overflow: detail(audit.overflow),
    nearFull: detail(audit.nearFull),
    plans,
    batches,
  });
});

const applySchema = z.object({
  moves: z.array(z.object({ bookId: z.string(), toLevelId: z.string() })).min(1),
  note: z.string().optional(),
});

/** 执行搬动。整批记一个 batchId，方便一键撤销。 */
export const POST = route(async (req: Request) => {
  rateLimit(req, "bulk");
  const { moves, note } = applySchema.parse(await readJson(req));

  const before = await prisma.placement.findMany({
    where: { bookId: { in: moves.map((m) => m.bookId) } },
    select: { bookId: true, levelId: true },
  });
  const result = await applyMoves(moves, note);
  return ok(result);
});

const undoSchema = z.object({ batchId: z.string().min(1) });

export const PATCH = route(async (req: Request) => {
  rateLimit(req, "bulk");
  const { batchId } = undoSchema.parse(await readJson(req));
  try {
    const { reverted, skipped } = await undoBatch(batchId);
    // skipped > 0 = 有些书回不去了（原来那层被拆了）。
    // 这必须让用户看见：报个 ok 了事的话，他会以为全撤回去了。
    return ok({ reverted, skipped });
  } catch (e) {
    if (e instanceof BatchNotFound) return fail("batch_not_found", 404);
    throw e;
  }
});
