// 书脊系数自校准 —— 算法见 lib/calibrate.ts
//
// 流程刻意分成两步：**记录测量 → 看拟合结果 → 人点了才应用**。
// 拟合出来的系数会影响全库每一层的装填率和"放不放得下"的判断，
// 自动应用等于让一次量错的卷尺读数悄悄改掉整个容量模型。
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCoefficients } from "@/lib/settings";
import { calibrate, type CalibrationSample } from "@/lib/calibrate";
import { estimateSpine } from "@/lib/capacity";
import { fail, ok, readJson, route } from "@/lib/api";

const KEY = "calibration.samples";

async function loadSamples(): Promise<CalibrationSample[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return (row?.value as CalibrationSample[] | undefined) ?? [];
}

async function saveSamples(samples: CalibrationSample[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: samples as unknown as object },
    update: { value: samples as unknown as object },
  });
}

/** 当前有哪些测量、拟合出来什么、比现在的系数好多少 */
export const GET = route(async () => {
  const [samples, coeffs] = await Promise.all([loadSamples(), getCoefficients()]);
  const result = calibrate(samples, coeffs);

  const levels = await prisma.level.findMany({
    where: { id: { in: samples.map((s) => s.levelId) } },
    select: { id: true, levelIndex: true, bookcase: { select: { name: true } } },
  });
  const meta = new Map(levels.map((l) => [l.id, l]));

  return ok({
    current: coeffs,
    result,
    samples: samples.map((s) => ({
      levelId: s.levelId,
      measuredMm: s.measuredMm,
      at: s.at,
      books: s.books.length,
      bookcaseName: meta.get(s.levelId)?.bookcase.name ?? null,
      levelIndex: meta.get(s.levelId)?.levelIndex ?? null,
      // 这一层现在估算是多宽 —— 和量出来的差多少，一眼看得见
      estimatedMm: Math.round(
        s.books.reduce((sum, b) => sum + estimateSpine(b, coeffs).mm, 0),
      ),
    })),
  });
});

const addSchema = z.object({
  levelId: z.string().min(1),
  /** 量出来的这层书实际占用宽度（毫米） */
  measuredMm: z.number().int().positive().max(5000),
});

/** 记一次测量。会把当时这层的书快照下来 —— 书以后换了，这条测量仍然有效。 */
export const POST = route(async (req: Request) => {
  const { levelId, measuredMm } = addSchema.parse(await readJson(req));

  const level = await prisma.level.findUnique({
    where: { id: levelId },
    include: {
      placements: {
        include: { book: { select: { pageCount: true, binding: true, spineMm: true } } },
      },
    },
  });
  if (!level) return fail("level_not_found", 404);
  if (!level.placements.length) return fail("level_empty", 422);
  if (measuredMm > level.widthMm) return fail("wider_than_shelf", 422);

  const sample: CalibrationSample = {
    levelId,
    measuredMm,
    at: new Date().toISOString(),
    books: level.placements.map((p) => ({
      pageCount: p.book.pageCount,
      binding: p.book.binding,
      spineMm: p.book.spineMm,
    })),
  };

  // 同一层重量一次就覆盖旧的，不然会把同一处的误差重复计入
  const samples = [...(await loadSamples()).filter((s) => s.levelId !== levelId), sample];
  await saveSamples(samples);

  const coeffs = await getCoefficients();
  return ok({ result: calibrate(samples, coeffs), samples: samples.length });
});

/** 应用拟合结果。人点了才走这里。 */
export const PATCH = route(async () => {
  const [samples, coeffs] = await Promise.all([loadSamples(), getCoefficients()]);
  const result = calibrate(samples, coeffs);
  if (result.status !== "ok") return fail(result.status, 422, { result });

  const next = {
    ...coeffs,
    mmPerPage: result.mmPerPage,
    basePaperbackMm: result.basePaperbackMm,
    baseHardcoverMm: result.baseHardcoverMm,
  };
  await prisma.setting.upsert({
    where: { key: "capacity.coefficients" },
    create: { key: "capacity.coefficients", value: next },
    update: { value: next },
  });
  return ok({ applied: next, result });
});

/** 删掉所有测量重来（量错了想从头开始） */
export const DELETE = route(async () => {
  await prisma.setting.deleteMany({ where: { key: KEY } });
  return ok({ cleared: true });
});
