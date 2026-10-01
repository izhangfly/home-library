import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { suggestTags } from "@/lib/tagSuggest";
import { ok, readJson, route } from "@/lib/api";

const schema = z.object({
  title: z.string().optional().nullable(),
  subtitle: z.string().optional().nullable(),
  subjects: z.array(z.string()).optional(),
  publisher: z.string().optional().nullable(),
  isPeriodical: z.boolean().optional(),
  language: z.string().optional().nullable(),
  /** 已定下的分类号 —— 用来剔掉只是重复它的建议 */
  clc: z.string().optional().nullable(),
});

export const POST = route(async (req: Request) => {
  const input = schema.parse(await readJson(req));
  const existing = await prisma.tag.findMany({ select: { id: true, name: true, nameEn: true } });
  return ok({ suggestions: suggestTags(input, existing) });
});
