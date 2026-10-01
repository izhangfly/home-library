// 中图法号：补算（含 AI 兜底）或手动指定。
// 入库时只跑离线规则，扫码流程在后台调这个补齐 AI 推断，不拖慢扫码。
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { refreshBookDerived } from "@/lib/books";
import { assignClc, assignClcManual, type ClcAssignInput } from "@/lib/clcAssign";
import { clcLabel, isValidClc } from "@/lib/clc";
import { resolveLocale } from "@/i18n/request";
import { fail, ok, readJson, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** 手动指定；留空则自动推断 */
  clc: z.string().trim().optional(),
  force: z.boolean().optional(),
});

export const POST = route(async (req: Request, { params }: Ctx) => {
  rateLimit(req, "llm");
  const { id } = await params;
  const body = req.headers.get("content-length") === "0" ? {} : await readJson(req).catch(() => ({}));
  const { clc: manual, force } = bodySchema.parse(body);

  // 手工填的号也要校验。以前不校验：填一个 M5（中图法没有 M 类），
  // normalizeClc 返回 null → 整条赋值变成空 → **这本书原来那个好好的号被抹掉了**，
  // 而接口还回 200，看起来像成功。宁可报错，也不能悄悄弄丢已有的分类。
  if (manual && !isValidClc(manual)) return fail("invalid_clc", 422, { clc: manual });

  const book = await prisma.book.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  if (!book) return fail("not_found", 404);

  // 手动指定过的号不该被自动推断覆盖
  if (!force && !manual && book.clc) {
    return ok({ clc: book.clc, clcSource: book.clcSource, unchanged: true });
  }
  if (!manual && book.clcSource === "manual" && !force) {
    return ok({ clc: book.clc, clcSource: book.clcSource, unchanged: true });
  }

  const input: ClcAssignInput = {
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors,
    publisher: book.publisher,
    language: book.language,
    subjects: book.subjects,
    tags: book.tags.map((t) => t.tag.name),
    summary: book.summary,
  };

  const a = manual ? assignClcManual(manual, input) : await assignClc(input);
  if (!a) return fail("invalid_clc", 422, { clc: manual });

  const updated = await prisma.book.update({
    where: { id },
    data: {
      clc: a.clc,
      clcSource: a.clcSource,
      callNumber: a.callNumber,
      callSortKey: a.callSortKey,
    },
  });

  // 分类号变了，completeness 也跟着变（它把"有没有分类号"算在内）。
  // 这里以前只写分类相关的四个字段就收工，于是 completeness 一直是旧的 ——
  // 6 本书里 5 本对不上，就是这么来的。派生字段统一交给 refreshBookDerived，
  // 别在各条写入路径上各自维护一份。
  await refreshBookDerived(id);

  const locale = await resolveLocale();
  return ok({
    clc: updated.clc,
    clcSource: updated.clcSource,
    callNumber: updated.callNumber,
    label: clcLabel(updated.clc, locale),
    matched: a.matched,
  });
});
