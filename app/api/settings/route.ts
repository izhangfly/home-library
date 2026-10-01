import { z } from "zod";
import { getCoefficients, saveCoefficients } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";
import { ok, readJson, route } from "@/lib/api";

export const GET = route(async () => {
  const coefficients = await getCoefficients();
  // 数据源的开关状态由环境变量决定，这里一并回给设置页展示
  const sources = {
    douban: process.env.DOUBAN_ENABLED !== "false",
    openLibrary: process.env.OPENLIBRARY_ENABLED !== "false",
    googleBooks: !!process.env.GOOGLE_BOOKS_API_KEY,
    wanzhou: !!process.env.WANZHOU_BASE_URL,
  };
  return ok({ coefficients, sources });
});

const schema = z.object({
  mmPerPage: z.number().positive().optional(),
  basePaperbackMm: z.number().min(0).optional(),
  baseHardcoverMm: z.number().min(0).optional(),
  defaultSpineMm: z.number().positive().optional(),
  tightThresholdMm: z.number().min(0).optional(),
  levelMarginMm: z.number().min(0).optional(),
  assumedHeightMm: z.number().positive().optional(),
  tagMmPerPage: z.record(z.string(), z.number().positive()).optional(),
});

// 系数会改变所有层的容量判断，等同于改书架结构 → 需要管理员
export const PATCH = route(async (req: Request) => {
  await requireAdmin();
  const input = schema.parse(await readJson(req));
  const coefficients = await saveCoefficients(input);
  return ok({ coefficients });
});
