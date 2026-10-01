// 索书号：补算（含 AI 兜底）或手动指定。
// 入库时只跑离线规则，扫码流程在后台调这个补齐 AI 推断，不拖慢扫码。
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { refreshBookDerived } from "@/lib/books";
import { openLibraryProvider } from "@/lib/providers/openLibrary";
import { assignDdc, assignDdcManual, type DdcAssignInput } from "@/lib/ddcAssign";
import { ddcLabel } from "@/lib/ddc";
import { resolveLocale } from "@/i18n/request";
import { fail, ok, readJson, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** 手动指定；留空则自动推断 */
  ddc: z.string().trim().optional(),
  /** 已经有号时也强制重算 */
  force: z.boolean().optional(),
});

export const POST = route(async (req: Request, { params }: Ctx) => {
  rateLimit(req, "llm");
  const { id } = await params;
  const body = req.headers.get("content-length") === "0" ? {} : await readJson(req).catch(() => ({}));
  const { ddc: manual, force } = bodySchema.parse(body);

  const book = await prisma.book.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  if (!book) return fail("not_found", 404);

  // 已经有权威号就别用推断去覆盖它
  if (!force && !manual && book.ddc && book.ddcSource === "openLibrary") {
    return ok({ ddc: book.ddc, ddcSource: book.ddcSource, unchanged: true });
  }

  // 重新分类时也要走一遍权威源。
  // 之前这里只问规则和模型，导致一次 force 重算就能把 OpenLibrary 的
  // 891.733 换成推断出来的 823，而且再也换不回来。
  let authoritative = book.ddcSource === "openLibrary" ? book.ddc : null;
  if (!authoritative && !manual && book.isbn13) {
    try {
      const found = await openLibraryProvider.byIsbn(book.isbn13, book.isbn10 ?? undefined);
      authoritative = found.find((c) => c.ddc)?.ddc ?? null;
    } catch {
      // 源挂了就算了，下面还有规则和模型兜底
    }
  }

  const input: DdcAssignInput = {
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors,
    publisher: book.publisher,
    language: book.language,
    tags: book.tags.map((t) => t.tag.name),
    // 存下来的主题词是重算时最强的证据，一定要带上
    subjects: book.subjects,
    summary: book.summary,
    // 已经有编目权威号时要带回去，否则 force 重算会把 891.733 这种真号
    // 覆盖成推断出来的粗号 —— 那是纯粹的信息损失
    authoritativeDdc: authoritative,
  };

  const assignment = manual ? assignDdcManual(manual, input) : await assignDdc(input);
  // 手工填的号不合法 → 明确报错。绝不能让它变成"清空这本书的号"然后回 200。
  if (!assignment) return fail("invalid_ddc", 422, { ddc: manual });

  const updated = await prisma.book.update({
    where: { id },
    data: {
      ddc: assignment.ddc,
      ddcSource: assignment.ddcSource,
      callNumber: assignment.callNumber,
      callSortKey: assignment.callSortKey,
    },
  });

  // 分类号变了，completeness 也跟着变（它把"有没有分类号"算在内）。
  // 这里以前只写分类相关的四个字段就收工，于是 completeness 一直是旧的 ——
  // 6 本书里 5 本对不上，就是这么来的。派生字段统一交给 refreshBookDerived，
  // 别在各条写入路径上各自维护一份。
  await refreshBookDerived(id);

  const locale = await resolveLocale();
  return ok({
    ddc: updated.ddc,
    ddcSource: updated.ddcSource,
    callNumber: updated.callNumber,
    label: ddcLabel(updated.ddc, locale),
    matched: assignment.matched,
  });
});
