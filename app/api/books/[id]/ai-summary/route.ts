// F9 —— 只在所有数据源都没给简介时兜底
import { prisma } from "@/lib/prisma";
import { generateAiSummary } from "@/lib/deepseek";
import { resolveLocale } from "@/i18n/request";
import { fail, ok, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  rateLimit(req, "llm");
  const { id } = await params;
  const book = await prisma.book.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  if (!book) return fail("not_found", 404);

  // 真实简介优先，绝不覆盖数据源给的内容（F9 OUT OF SCOPE 明确禁止）
  if (book.summary?.trim()) return fail("has_real_summary", 409);

  const locale = await resolveLocale();
  const result = await generateAiSummary({
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors,
    translators: book.translators,
    publisher: book.publisher,
    pubDate: book.pubDate,
    language: book.language,
    tags: book.tags.map((t) => t.tag.name),
    locale,
  });

  if (result.status === "error") return fail("ai_error", 502, { detail: result.error });

  // insufficient 时把 aiSummary 清空 —— 宁可没有，也不留一句模糊的废话
  const updated = await prisma.book.update({
    where: { id },
    data: {
      aiSummary: result.status === "ok" ? result.summary : null,
      aiSummaryAt: result.status === "ok" ? new Date() : null,
    },
  });

  return ok({ status: result.status, aiSummary: updated.aiSummary });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await prisma.book.update({
    where: { id },
    data: { aiSummary: null, aiSummaryAt: null },
  });
  return ok({ deleted: true });
});
